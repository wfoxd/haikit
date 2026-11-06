/**
 * @haikit/mcp — call MCP servers' tools from inside your own tools.
 *
 * The model never sees an MCP tool. An app declares the server tools it calls,
 * typed by schemas it owns, and calls them from a HaiKIT tool's `run` or an
 * action handler, the way it would call a database: that code decides what the
 * model hears of a result and what the browser shows. So nothing a third-party
 * server says — its tools' names and descriptions, its instructions, its
 * results — reaches the model unless app code puts it there.
 *
 * There is no way to make a HaiKIT `Tool` from an MCP tool here, on purpose:
 * an `McpTool` has no `run`, so `createHai({ tools })` won't take one.
 *
 * Imports only @haikit/core, like the model adapters.
 */

import { createRequire } from "node:module";
import type { Progress, Schema } from "@haikit/core";
import {
  Client,
  InsufficientScopeError,
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  UnauthorizedError,
  type AuthProvider,
  type CallToolResult,
  type ContentBlock,
  type Tool as ServerTool,
  type Transport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { configOf, type AuthConfig, type Binding, type McpServerAuth } from "./auth.js";
import { LookupFailed, Mismatch, NeedsAuth, type Credential } from "./credential.js";
import { McpError, McpToolError, isMcpError, type McpAuthNeed, type McpErrorReason } from "./errors.js";
import { madeByHttp, unanswered } from "./transports.js";

export {
  createMcpAuth,
  type McpAccount,
  type McpAuth,
  type McpAuthOptions,
  type McpConnected,
  type McpServerAuth,
  type OAuthServerOptions,
} from "./auth.js";
export { McpError, McpToolError, isMcpError, isMcpToolError, type McpAuthNeed, type McpErrorReason } from "./errors.js";
export { accountConnected, connectCard, connectCardFor, type ConnectCardProps } from "./contracts.js";
export { textOf, type TextOptions } from "./text.js";
export { memoryCredentialStore, type CredentialStore } from "./store.js";
export { http, stdio, type HttpOptions } from "./transports.js";
export type { AuthProvider, ContentBlock, OAuthClientProvider, Transport } from "@modelcontextprotocol/client";

const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

const TIMEOUT_MS = 30_000;
/** Under the 120 s turn lease the stores default to, which isn't renewed while a tool runs. */
const MAX_TOTAL_MS = 90_000;
/** Past the longest timer Node keeps, it fires after about a millisecond. */
const MAX_TIMER_MS = 2_147_483_647;
const MAX_CONNECTIONS = 100;
const IDLE_MS = 300_000;
/**
 * The SDK's own checks of a tool's result against the output schema the
 * server declared, as of @modelcontextprotocol/client 2.4: `callTool` throws
 * these, with these codes and words, once the server has answered. A
 * server's own error reads as one only if it has the same code and words.
 */
const OUTPUT_CHECKS: ReadonlyArray<readonly [code: number, words: RegExp]> = [
  [ProtocolErrorCode.InvalidRequest, /^Tool .+ has an output schema but did not return structured content$/],
  [ProtocolErrorCode.InvalidParams, /^Structured content does not match the tool's output schema: /],
  [ProtocolErrorCode.InvalidParams, /^Failed to validate structured content: /],
];

export interface McpServerOptions {
  /** Names the server in errors and warnings, as in `github/search_issues`. */
  name: string;
  /**
   * Makes a connection: called by the first `connect()` or call, and again
   * for each reconnect. `http(url)` and `stdio({ command })` make one. For a
   * server with `auth`, it's given the user's `AuthProvider`, and must be
   * `http()`'s.
   */
  transport: (authProvider?: AuthProvider) => Transport | Promise<Transport>;
  /**
   * Makes each call as the user it runs for, with their own credential, over
   * a connection of their own: `mcpAuth.oauth()`, `mcpAuth.bearer(token)` or
   * `mcpAuth.sdk(make)`, from `createMcpAuth`. Without it, every call shares
   * one connection and one identity.
   */
  auth?: McpServerAuth;
  /**
   * With `auth`: the most users connected at once. Past it, the least recently
   * used connection with no call in flight is closed. Default 100.
   */
  maxConnections?: number;
  /** With `auth`: a user's connection is closed after this long with no call, in milliseconds. Default 300,000. */
  idleMs?: number;
  /**
   * How long the server may go without answering a call or reporting progress
   * on it, in milliseconds. Also bounds making the transport, connecting,
   * listing tools and, with `auth`, looking up a user's token. Default 30,000.
   */
  timeoutMs?: number;
  /**
   * The longest a call may take, progress or not, connecting included, in
   * milliseconds. Default 90,000.
   */
  maxTotalMs?: number;
  /**
   * A declared tool was removed from the server, or its schema changed: seen
   * when the server says its tools changed, and on a reconnect. Calls go on
   * as before; one to a removed tool fails. Default: a `console.warn`. If it
   * throws, the error is logged with `console.error`.
   */
  onChange?: (change: McpToolChange) => void;
  /** The SDK's protocol version negotiation. Default `"legacy"`, the SDK's own: the 2025 handshake. */
  versionNegotiation?: VersionNegotiationMode;
}

export interface McpToolChange {
  server: string;
  /** With `auth`: the user whose connection saw the change. Each user's tools are compared apart. */
  user?: string;
  /** Declared tools the server no longer has. */
  removed: string[];
  /** Declared tools whose input or output schema, or task support, changed. */
  changed: string[];
}

export interface McpToolDef<A, R> {
  /** Checks the args before anything is sent. They must come out an object. */
  args: Schema<A>;
  /**
   * Checks the result, which `call` then resolves to: the server's structured
   * result, or, without one, the JSON in its one text block. Without this,
   * `call` resolves to the result's content as the server sent it.
   */
  result?: Schema<R>;
  /** Overrides the server's `timeoutMs` for this tool. */
  timeoutMs?: number;
  /** Overrides the server's `maxTotalMs` for this tool. */
  maxTotalMs?: number;
}

/** A result with no `result` schema: what the server sent, unchecked. */
export interface McpResult {
  /** The content blocks, as the server sent them. */
  content: ContentBlock[];
  /** The server's structured result, when it sent one. */
  structuredContent?: unknown;
}

/**
 * What a call is made for. A HaiKIT tool's `ctx` or an action handler's can
 * be passed as it is.
 */
export interface McpCallCtx {
  /**
   * The conversation the call is for. A server with `auth` calls as its
   * owner, from `userOf`.
   */
  readonly conversationId?: string;
  /**
   * For a server with `auth`: the user to call as, for a call made outside any
   * conversation, such as a job. With a `conversationId` too, it must be the
   * conversation's owner.
   */
  readonly userId?: string;
  /** Hears the server's progress notifications, as `ToolCtx.progress` does. */
  progress?(progress: Progress): void;
}

/** One of the server's tools, as the app declared it. Not a HaiKIT `Tool`: the model never sees it. */
export interface McpTool<A, R> {
  readonly server: string;
  readonly name: string;
  /**
   * Calls the tool. Throws `McpToolError` when the tool reports an error, and
   * `McpError` when the call gets no result, or one its schema refuses.
   */
  call(args: A, ctx?: McpCallCtx): Promise<R>;
}

/** The connection to one MCP server, and the tools the app may call on it. */
export interface McpConnection {
  readonly name: string;
  /**
   * Declares one of the server's tools: the only way to call it. Declared
   * after `connect()`, it is checked against the server's tools at once.
   */
  tool<A, R>(name: string, def: McpToolDef<A, R> & { result: Schema<R> }): McpTool<A, R>;
  tool<A>(name: string, def: McpToolDef<A, unknown> & { result?: undefined }): McpTool<A, McpResult>;
  /**
   * Connects, and checks every declared tool: it throws if the server has no
   * tool of that name, or one that can only run as an MCP task. Call it at
   * startup, so a mistake stops the app there; the first call connects
   * otherwise, and fails with the same error. A server with `auth` needs
   * the user to connect as, and checks the tools that user sees.
   */
  connect(userId?: string): Promise<void>;
  /**
   * For a server with `auth`: closes the user's connection, if they have
   * one. Their next call makes a new one, and looks up their credential again.
   */
  forget(userId: string): Promise<void>;
  /** Closes the connection, and stops a `stdio` server. Final: a later call fails with reason `closed`. */
  close(): Promise<void>;
}

/** The connection to an MCP server. Nothing connects until `connect()` or the first call. */
export function mcpServer(options: McpServerOptions): McpConnection {
  return new Server(options);
}

interface Detail {
  cause?: unknown;
  text?: string;
  code?: number;
  auth?: McpAuthNeed;
  /** For reason `user`: why there's no user to call as. */
  user?: "none" | "lookup" | "other";
}

const NO_USER = {
  none: "there is no user to call it as",
  lookup: "the user it runs for could not be looked up",
  other: "its userId is not the conversation's owner",
};

const MESSAGES: Record<McpErrorReason, (who: string, detail: Detail) => string> = {
  args: (who) => `${who} was not called: its args do not match the schema`,
  result: (who) => `${who} returned a result that does not match the schema`,
  timeout: (who) => `${who} did not answer in time`,
  connection: (who) => `${who} could not be reached`,
  protocol: (who) => `${who} was refused by the server`,
  closed: (who) => `${who}: the connection was closed`,
  user: (who, { user = "none" }) => `${who} was not called: ${NO_USER[user]}`,
  auth: (who, { auth }) =>
    auth?.kind === "connect"
      ? `${who}: the user has not connected an account`
      : auth?.kind === "scope"
        ? `${who}: the user's account needs more access`
        : `${who}: the server refused the user's credential`,
};

class Server implements McpConnection {
  readonly name: string;
  readonly options: McpServerOptions;
  readonly timeoutMs: number;
  private readonly maxTotalMs: number;
  /** With `auth`: whose calls are made as whom. */
  readonly auth: AuthConfig | null;
  /** With `auth`: this server's place on its `McpAuth`, which makes each user's credential. */
  private readonly binding: Binding | null;
  private readonly maxConnections: number;
  readonly idleMs: number;
  /** Without `auth`: the one connection every call shares. */
  private readonly shared: Link | null;
  /** With `auth`: each user's connection, the least recently used first. */
  private readonly links = new Map<string, Link>();
  private closed = false;
  /** Aborted by `close()`: a call waiting on anything stops with reason `closed`. */
  private readonly shutdown = new AbortController();
  /** The first `close()`, which the others wait for. */
  private closing: Promise<void> | null = null;
  /** The tools `tool()` declared: the only ones that can be called. */
  readonly declared = new Set<string>();

  constructor(options: McpServerOptions) {
    if (typeof options.name !== "string" || options.name === "") {
      throw new TypeError("name must be a non-empty string");
    }
    if (typeof options.transport !== "function") {
      throw new TypeError("transport must be a function that makes a Transport, such as http(url) or stdio({ command })");
    }
    this.name = options.name;
    this.options = options;
    this.timeoutMs = checkMs("timeoutMs", options.timeoutMs ?? TIMEOUT_MS);
    this.maxTotalMs = checkMs("maxTotalMs", options.maxTotalMs ?? MAX_TOTAL_MS);

    if (options.auth === undefined) {
      if (options.maxConnections !== undefined || options.idleMs !== undefined) {
        throw new TypeError("maxConnections and idleMs are for a server with auth: without it, every call shares one connection");
      }
      this.auth = null;
      this.maxConnections = 1;
      this.idleMs = IDLE_MS;
      this.shared = new Link(this, undefined, null);
      this.binding = null;
      return;
    }
    const auth = configOf(options.auth);
    if (!auth) throw new TypeError("auth must come from createMcpAuth(), such as mcpAuth.bearer(token)");
    const made = madeByHttp.get(options.transport);
    if (!made) {
      throw new TypeError("auth needs a transport made by http(url): stdio() and other transports can't carry each user's credential");
    }
    if (made.authProvider) throw new TypeError("auth gives the transport each user's credential: http() can't be given an authProvider as well");
    if (made.authorization) throw new TypeError("auth sets each user's Authorization header: http() can't send one of its own as well");
    const max = options.maxConnections ?? MAX_CONNECTIONS;
    if (typeof max !== "number" || !Number.isSafeInteger(max) || max < 1) {
      throw new RangeError(`maxConnections must be a whole number, 1 or more (got ${String(max)})`);
    }
    this.idleMs = checkMs("idleMs", options.idleMs ?? IDLE_MS);
    this.maxConnections = max;
    // last, so a server refused above leaves its name free
    this.binding = auth.attach({ name: this.name, timeoutMs: this.timeoutMs, url: made.url, fetch: made.fetch, forget: (user) => this.forget(user) });
    this.auth = auth;
    this.shared = null;
  }

  tool(name: string, def: McpToolDef<any, any>): McpTool<any, any> {
    if (typeof name !== "string" || name === "") throw new TypeError("a tool's name must be a non-empty string");
    if (typeof def?.args?.parse !== "function") {
      throw new TypeError(`tool "${name}" needs an args schema: anything with a parse method`);
    }
    if (def.result !== undefined && typeof def.result.parse !== "function") {
      throw new TypeError(`tool "${name}" has a result schema with no parse method`);
    }
    if (def.timeoutMs !== undefined) checkMs("timeoutMs", def.timeoutMs);
    if (def.maxTotalMs !== undefined) checkMs("maxTotalMs", def.maxTotalMs);
    // checked against the latest tools, even if declared before; each user's
    // connection checks a tool declared late on its first call to it
    this.shared?.verify(name, true);
    this.declared.add(name);
    return Object.freeze({
      server: this.name,
      name,
      call: (args: unknown, ctx?: McpCallCtx) => this.call(name, def, args, ctx),
    });
  }

  async connect(userId?: string): Promise<void> {
    if (this.shared) {
      if (userId !== undefined) throw new TypeError("connect() takes a user only for a server with auth");
      await this.shared.open();
      return;
    }
    if (typeof userId !== "string" || userId === "") {
      throw new TypeError("connect() needs a userId for a server with auth: each user's connection is checked as it's made");
    }
    if (this.closed) throw this.error("closed", undefined);
    const link = this.take(userId);
    try {
      await link.ready();
    } catch (err) {
      throw this.linked(err, undefined);
    } finally {
      link.release();
    }
  }

  async forget(userId: string): Promise<void> {
    if (!this.auth) throw new TypeError("forget() is for a server with auth: without it, every call shares one connection");
    if (typeof userId !== "string" || userId === "") throw new TypeError("forget() needs a userId");
    const link = this.links.get(userId);
    if (!link) return;
    this.links.delete(userId);
    await link.close();
  }

  close(): Promise<void> {
    // every close() resolves once the first has closed everything
    this.closing ??= this.shut();
    return this.closing;
  }

  private async shut(): Promise<void> {
    this.closed = true;
    this.shutdown.abort();
    this.binding?.detach();
    const links = this.shared ? [this.shared] : [...this.links.values()];
    this.links.clear();
    await Promise.all(links.map((link) => link.close()));
  }

  /** The user's connection, made if need be, marked most recently used, and held for a call. */
  private take(user: string): Link {
    let link = this.links.get(user);
    if (link) {
      this.links.delete(user);
    } else {
      this.trim(this.maxConnections - 1);
      link = new Link(this, user, this.binding!.credential(user));
    }
    this.links.set(user, link);
    link.hold();
    return link;
  }

  /** Closes the least recently used connections with no call in flight, down to `limit`. */
  trim(limit = this.maxConnections): void {
    for (const [user, link] of this.links) {
      if (this.links.size <= limit) return;
      // when every link is busy, the pool grows past the cap until one is free
      if (link.busy === 0) this.drop(user, link);
    }
  }

  /** Closes a user's connection, unless another has replaced it. */
  drop(user: string, link: Link): void {
    if (this.links.get(user) !== link) return;
    this.links.delete(user);
    link.close().catch(() => {});
  }

  /**
   * Who a call on a server with `auth` runs as: the conversation's owner, or
   * the `userId` of a call made outside any conversation. Never anyone else.
   */
  private async userFor(ctx: McpCallCtx | undefined, tool: string): Promise<string> {
    const conversationId = nonEmpty(ctx?.conversationId);
    const given = nonEmpty(ctx?.userId);
    if (conversationId === undefined) {
      if (given === undefined) throw this.error("user", tool);
      return given;
    }
    let owner: unknown;
    try {
      owner = await this.auth!.userOf(conversationId);
    } catch (err) {
      throw this.error("user", tool, { cause: err, user: "lookup" });
    }
    if (typeof owner !== "string" || owner === "") throw this.error("user", tool);
    if (given !== undefined && given !== owner) throw this.error("user", tool, { user: "other" });
    return owner;
  }

  private async call(tool: string, def: McpToolDef<unknown, unknown>, args: unknown, ctx: McpCallCtx | undefined) {
    let input: unknown;
    try {
      input = def.args.parse(args);
    } catch (err) {
      throw this.error("args", tool, { cause: err });
    }
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new McpError("args", `${this.name}/${tool} was not called: its args must be an object`, {
        server: this.name,
        tool,
      });
    }

    // maxTotalMs bounds the whole call, connecting included, and is ours to
    // keep: the SDK checks its own maxTotalTimeout only when progress comes
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), def.maxTotalMs ?? this.maxTotalMs);
    let link: Link | undefined;
    let result: CallToolResult;
    try {
      if (this.shared) {
        link = this.shared;
      } else {
        if (this.closed) throw this.error("closed", tool);
        const user = await this.until(deadline.signal, tool, this.userFor(ctx, tool));
        if (this.closed) throw this.error("closed", tool);
        link = this.take(user);
      }
      let client: Client;
      try {
        client = await this.until(deadline.signal, tool, link.ready());
      } catch (err) {
        // named again for this call, with what the server said; the
        // declared-tool check throws as it is
        if (!isMcpError(err) || err.tool === tool) throw err;
        throw this.error(err.reason, tool, { cause: err.cause ?? err, text: err.text, code: err.code, auth: err.auth });
      }
      link.verify(tool);
      try {
        result = await client.callTool(
          { name: tool, arguments: input as Record<string, unknown> },
          {
            timeout: def.timeoutMs ?? this.timeoutMs,
            // cancels the request, and rejects it as a timeout
            signal: deadline.signal,
            // asked for whether or not anyone hears it, so progress always
            // keeps a long call alive
            resetTimeoutOnProgress: true,
            onprogress: (p) => {
              ctx?.progress?.({
                done: p.progress,
                ...(p.total === undefined ? {} : { total: p.total }),
                ...(p.message === undefined ? {} : { message: p.message }),
              });
            },
          },
        );
      } catch (err) {
        throw link.failure(err, tool, client);
      }
    } catch (err) {
      throw this.linked(err, nonEmpty(ctx?.conversationId));
    } finally {
      clearTimeout(timer);
      if (link !== this.shared) link?.release();
    }

    const content = result.content ?? [];
    if (result.isError) throw new McpToolError(this.name, tool, content);
    if (!def.result) {
      return result.structuredContent === undefined ? { content } : { content, structuredContent: result.structuredContent };
    }

    let value: unknown;
    if (result.structuredContent !== undefined) {
      value = result.structuredContent;
    } else {
      const only = content.length === 1 ? content[0] : undefined;
      if (only?.type !== "text") {
        throw this.error("result", tool, {
          cause: new Error("the result has no structured content, and isn't one text block"),
        });
      }
      try {
        value = JSON.parse(only.text);
      } catch (err) {
        throw this.error("result", tool, { cause: err });
      }
    }
    try {
      return def.result.parse(value);
    } catch (err) {
      throw this.error("result", tool, { cause: err });
    }
  }

  /** What `promise` resolves to, unless `close()` comes first (`closed`), or `deadline` aborts (`timeout`). */
  private until<T>(deadline: AbortSignal, tool: string, promise: Promise<T>): Promise<T> {
    return unless(promise, [
      [this.shutdown.signal, () => this.error("closed", tool)],
      [deadline, () => this.error("timeout", tool)],
    ]);
  }

  /**
   * An `auth` error of an `oauth()` server, with the connect route's path for
   * the browser: for the call's conversation, and the scope the server asked
   * for. Built from configuration, never from what the server said but that
   * scope. Any other error, as it is.
   */
  private linked(err: unknown, conversationId: string | undefined): unknown {
    const connect = this.binding?.connect;
    if (!connect || !isMcpError(err) || err.reason !== "auth" || !err.auth) return err;
    const auth: McpAuthNeed = { ...err.auth, connect: connect(conversationId, err.auth.kind === "scope" ? err.auth.scope : undefined) };
    return new McpError("auth", err.message, { server: err.server, tool: err.tool, text: err.text, code: err.code, cause: err.cause, auth });
  }

  error(reason: McpErrorReason, tool: string | undefined, detail: Detail = {}): McpError {
    const who = tool === undefined ? this.name : `${this.name}/${tool}`;
    const { user, ...kept } = detail;
    return new McpError(reason, MESSAGES[reason](who, detail), { server: this.name, tool, ...kept });
  }
}

/**
 * One SDK client over one transport, for one identity: the server's own, or
 * one user's. It connects when first needed, and again after it drops.
 */
class Link {
  /** The connected client, or null between connections. */
  private client: Client | null = null;
  private dialing: Promise<Client> | null = null;
  /** While a connection is being made: its client, once there is one, so `close()` can stop it. */
  private connecting: Client | null = null;
  /** While `transport()` is pending: gives up on it, for `close()`. */
  private abandon: (() => void) | null = null;
  private closed = false;
  /** Aborted by `close()`: stops a wait for the credential, which no transport is there to stop. */
  private readonly ending = new AbortController();
  /** The first `close()`, which the others wait for. */
  private closing: Promise<void> | null = null;
  /** Clients whose connection has gone. */
  private readonly dropped = new WeakSet<Client>();
  /** The transport each client was made over: the client lets go of it once closed. */
  private readonly transports = new WeakMap<Client, Transport>();
  /** The server's tools at the last listing, by name. Null until a first connect passes the check. */
  private listed: Map<string, ServerTool> | null = null;
  /** The declared tools checked against this connection's tools. */
  private readonly checked = new Set<string>();
  /** The credential's check before a call, which calls at once share. */
  private checking: Promise<void> | null = null;
  /** Calls and `connect()`s using it now: a busy link is never closed for room or for idling. */
  busy = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly server: Server,
    /** The user it calls as; undefined for the server's own identity. */
    private readonly user: string | undefined,
    private readonly credential: Credential | null,
  ) {}

  hold(): void {
    this.busy++;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  release(): void {
    if (--this.busy > 0 || this.user === undefined || this.closed) return;
    const user = this.user;
    this.idle = setTimeout(() => this.server.drop(user, this), this.server.idleMs);
    this.idle.unref?.();
    // a pool grown past its cap shrinks as soon as a connection is free
    this.server.trim();
  }

  /** Connected, with a credential if it needs one. */
  async ready(): Promise<Client> {
    if (this.credential && !this.closed) {
      const credential = this.credential;
      this.checking ??= this.check(credential).finally(() => {
        this.checking = null;
      });
      try {
        await unless(this.checking, [[this.ending.signal, () => this.server.error("closed", undefined)]]);
      } catch (err) {
        // closed, whatever the lookup did meanwhile
        if (this.closed) throw isMcpError(err) ? err : this.server.error("closed", undefined, { cause: err });
        throw this.authFailure(err, undefined) ?? err;
      }
    }
    return this.open();
  }

  /**
   * The credential, before a call. A connection made with one that's gone,
   * or that the user has since replaced by connecting again, is hung up, so
   * nothing more is sent with it, and the next is made with what's held now.
   */
  private async check(credential: Credential): Promise<void> {
    let changed: boolean;
    try {
      changed = await credential.ensure();
    } catch (err) {
      if (err instanceof NeedsAuth) await this.hangUp();
      throw err;
    }
    if (changed) await this.hangUp();
  }

  /** Ends the connection, as when it drops, but not the link: the next call connects again. */
  private async hangUp(): Promise<void> {
    await this.dialing?.catch(() => {});
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => {});
  }

  /**
   * A tool declared after this connection's first check is checked on its
   * first call, and throws as `connect` would. `again` checks it against the
   * latest tools even if it was checked before.
   */
  verify(tool: string, again = false): void {
    if (!this.listed || (!again && this.checked.has(tool))) return;
    const problem = problemWith(tool, this.listed);
    if (problem) throw new Error(`${this.server.name}: ${problem}`);
    this.checked.add(tool);
  }

  open(): Promise<Client> {
    if (this.closed) return Promise.reject(this.server.error("closed", undefined));
    if (this.client) return Promise.resolve(this.client);
    // one connection at a time: calls that arrive meanwhile share it
    this.dialing ??= this.dial().finally(() => {
      this.dialing = null;
      this.connecting = null;
    });
    return this.dialing;
  }

  close(): Promise<void> {
    // every close() resolves once the first has closed everything
    this.closing ??= this.shut();
    return this.closing;
  }

  private async shut(): Promise<void> {
    this.closed = true;
    this.ending.abort();
    // a lookup that never answers would keep its timer, and the process, going
    this.credential?.close();
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const client = this.client;
    this.client = null;
    // a connection still being made is stopped where it is, and sees `closed`
    this.abandon?.();
    await this.connecting?.close().catch(() => {});
    await this.dialing?.catch(() => {});
    await client?.close();
  }

  /**
   * What `transport()` makes, within `timeoutMs` and unless `close()` comes
   * first. A transport made after that is closed when it comes.
   */
  private async made(): Promise<Transport> {
    const { options, timeoutMs } = this.server;
    const authProvider = this.credential?.provider;
    // An OAuthClientProvider, from sdk(), goes to http()'s transport as it
    // is, which adapts it: only http() is ever given one.
    const making = Promise.resolve().then(() => (authProvider ? options.transport(authProvider as AuthProvider) : options.transport()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no transport within ${timeoutMs} ms`)), timeoutMs);
      this.abandon = () => reject(new Error("closed while the transport was being made"));
    });
    try {
      return await Promise.race([making, cut]);
    } catch (err) {
      making.then((transport) => transport.close()).catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
      this.abandon = null;
    }
  }

  private async dial(): Promise<Client> {
    const { server } = this;
    let client: Client | undefined;
    try {
      const transport = await this.made();
      // close() may have come as it was made, with nothing yet to stop
      if (this.closed) {
        await transport.close().catch(() => {});
        throw new Error("closed as the transport was made");
      }
      const self: Client = new Client(
        { name: "haikit", version: VERSION },
        {
          // No capabilities are advertised, so a server has no reason to ask
          // this client for input; one that does gets the call refused,
          // rather than a reply nobody wrote.
          inputRequired: { autoFulfill: false },
          ...(server.options.versionNegotiation === undefined
            ? {}
            : { versionNegotiation: { mode: server.options.versionNegotiation } }),
          listChanged: {
            tools: {
              onChanged: (error, tools) => {
                if (!error && tools && this.client === self) this.compare(tools);
              },
            },
          },
        },
      );
      client = self;
      this.connecting = self;
      this.transports.set(self, transport);
      self.onclose = () => {
        this.dropped.add(self);
        if (this.client === self) this.client = null;
      };
      await self.connect(transport, { timeout: server.timeoutMs });
    } catch (err) {
      await client?.close().catch(() => {});
      if (this.closed) throw server.error("closed", undefined, { cause: err });
      throw this.authFailure(err, undefined) ?? server.error("connection", undefined, { cause: err });
    }

    let tools: ServerTool[];
    try {
      ({ tools } = await client.listTools(undefined, { timeout: server.timeoutMs }));
    } catch (err) {
      await client.close().catch(() => {});
      throw this.failure(err, undefined, client);
    }

    if (this.listed === null) {
      const listing = new Map(tools.map((t) => [t.name, t]));
      const problems = [...server.declared].flatMap((name) => problemWith(name, listing) ?? []);
      if (problems.length) {
        await client.close().catch(() => {});
        throw new Error(`${server.name}: ${problems.join("; ")}`);
      }
      this.listed = listing;
      for (const name of server.declared) this.checked.add(name);
    } else {
      this.compare(tools);
    }

    if (this.closed) {
      await client.close().catch(() => {});
      throw server.error("closed", undefined);
    }
    if (this.dropped.has(client)) throw server.error("connection", undefined);
    this.client = client;
    return client;
  }

  /** Report what changed about the declared tools since the last listing, and keep this one. */
  private compare(tools: ServerTool[]): void {
    const before = this.listed ?? new Map<string, ServerTool>();
    const next = new Map(tools.map((t) => [t.name, t]));
    this.listed = next;
    const removed: string[] = [];
    const changed: string[] = [];
    for (const name of this.server.declared) {
      const was = before.get(name);
      const now = next.get(name);
      if (!was) continue;
      if (!now) removed.push(name);
      else if (shape(was) !== shape(now)) changed.push(name);
    }
    if (!removed.length && !changed.length) return;
    const change: McpToolChange =
      this.user === undefined ? { server: this.server.name, removed, changed } : { server: this.server.name, user: this.user, removed, changed };
    try {
      (this.server.options.onChange ?? warn)(change);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * An error about the user's credential, as one of ours, or null for any
   * other. A server without `auth` has none: its SDK errors read as in
   * `failure`.
   */
  private authFailure(err: unknown, tool: string | undefined): McpError | null {
    const { server } = this;
    if (err instanceof NeedsAuth) return server.error("auth", tool, { auth: { kind: err.kind } });
    if (err instanceof LookupFailed) return server.error("connection", tool, { cause: err.cause });
    if (err instanceof Mismatch) return server.error("protocol", tool, { cause: err });
    if (!this.credential) return null;
    if (err instanceof InsufficientScopeError) {
      const auth: McpAuthNeed = err.requiredScope ? { kind: "scope", scope: err.requiredScope } : { kind: "scope" };
      return server.error("auth", tool, { cause: err, text: err.message, auth });
    }
    // a 401 again on the transport's one retry, after onUnauthorized found a token
    if (err instanceof UnauthorizedError || (err instanceof SdkHttpError && err.code === SdkErrorCode.ClientHttpAuthentication)) {
      return server.error("auth", tool, { cause: err, text: err.message, auth: { kind: "reconnect" } });
    }
    return null;
  }

  /** An SDK error, as one of ours. */
  failure(err: unknown, tool: string | undefined, client: Client): McpError {
    const { server } = this;
    if (isMcpError(err)) return err;
    if (this.closed) return server.error("closed", tool, { cause: err });
    const auth = this.authFailure(err, tool);
    if (auth) return auth;
    if (this.gone(err, client)) {
      this.lose(client);
      return server.error("connection", tool, { cause: err });
    }
    if (err instanceof ProtocolError) {
      // The SDK's own check of a call's result throws one too: the server's
      // result is at fault there, not the call. Only a call has a result.
      const checked = tool !== undefined && OUTPUT_CHECKS.some(([code, words]) => err.code === code && words.test(err.message));
      return server.error(checked ? "result" : "protocol", tool, { cause: err, text: err.message, code: err.code });
    }
    if (err instanceof SdkError) {
      switch (err.code) {
        case SdkErrorCode.RequestTimeout:
          return server.error("timeout", tool, { cause: err });
        case SdkErrorCode.NotConnected:
        case SdkErrorCode.ConnectionClosed:
        case SdkErrorCode.SendFailed:
        case SdkErrorCode.ClientHttpFailedToOpenStream:
          return server.error("connection", tool, { cause: err });
        case SdkErrorCode.InvalidResult:
          // only a call has a result; a listing the SDK can't read is the server's fault
          if (tool !== undefined) return server.error("result", tool, { cause: err });
          return server.error("protocol", tool, { cause: err, text: err.message });
        default:
          return server.error("protocol", tool, { cause: err, text: err.message });
      }
    }
    // the SDK throws a plain Error for a call on a connection that has gone
    return server.error(this.dropped.has(client) ? "connection" : "protocol", tool, { cause: err });
  }

  /**
   * Whether an HTTP connection has gone, which its transport never says: it
   * closes only on `close()`. The server ended the session (a 404 to a
   * request that carried its id), or a request got no answer at all. The
   * session id is the transport's, which keeps it once the client is closed.
   */
  private gone(err: unknown, client: Client): boolean {
    if (err instanceof SdkHttpError) return err.status === 404 && this.transports.get(client)?.sessionId !== undefined;
    return typeof err === "object" && err !== null && unanswered.has(err);
  }

  /** Forgets a connection that has gone, and closes it: the next call makes a new one. */
  private lose(client: Client): void {
    this.dropped.add(client);
    if (this.client === client) this.client = null;
    client.close().catch(() => {});
  }
}

/**
 * What `promise` resolves to, unless one of `stops` aborts first: then it
 * rejects with what that stop's `error()` makes, the first in the list if
 * more than one has. `promise` is left to settle on its own, and holds
 * nothing of this wait: every listener goes as soon as it ends, however it
 * ends, so one that never settles leaves none on a long-lived signal.
 */
function unless<T>(promise: Promise<T>, stops: ReadonlyArray<readonly [AbortSignal, () => unknown]>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const offs: Array<() => void> = [];
    const end =
      <V>(settle: (value: V) => void) =>
      (value: V) => {
        for (const off of offs) off();
        settle(value);
      };
    const fulfil = end(resolve);
    const fail = end(reject);
    for (const [signal, error] of stops) {
      const stop = () => fail(error());
      signal.addEventListener("abort", stop, { once: true });
      offs.push(() => signal.removeEventListener("abort", stop));
    }
    promise.then(fulfil, fail);
    // an abort that came before is never heard as an event
    const done = stops.find(([signal]) => signal.aborted);
    if (done) fail(done[1]());
  });
}

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

function checkMs(label: string, ms: number): number {
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms <= 0 || ms > MAX_TIMER_MS) {
    throw new RangeError(`${label} must be a whole number of milliseconds, from 1 to ${MAX_TIMER_MS} (got ${String(ms)})`);
  }
  return ms;
}

function problemWith(name: string, listing: Map<string, ServerTool>): string | null {
  const tool = listing.get(name);
  if (!tool) return `the server has no tool named "${name}"`;
  if (tool.execution?.taskSupport === "required") {
    return `tool "${name}" can only run as an MCP task, which @haikit/mcp does not support`;
  }
  return null;
}

/** What a change to a tool can break: its schemas, and whether it must run as a task. */
const shape = (tool: ServerTool): string =>
  JSON.stringify([tool.inputSchema, tool.outputSchema ?? null, tool.execution?.taskSupport ?? null]);

function warn(change: McpToolChange): void {
  const parts = [
    ...change.removed.map((name) => `tool "${name}" was removed`),
    ...change.changed.map((name) => `tool "${name}" changed its schema`),
  ];
  const whose = change.user === undefined ? "" : ` (for user ${change.user})`;
  console.warn(`@haikit/mcp: ${change.server}${whose}: ${parts.join("; ")}`);
}
