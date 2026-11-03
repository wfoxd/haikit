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
  ProtocolError,
  SdkError,
  SdkErrorCode,
  type CallToolResult,
  type ContentBlock,
  type Tool as ServerTool,
  type Transport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { McpError, McpToolError, isMcpError, type McpErrorReason } from "./errors.js";

export { McpError, McpToolError, isMcpError, isMcpToolError, type McpErrorReason } from "./errors.js";
export { textOf, type TextOptions } from "./text.js";
export { http, stdio, type HttpOptions } from "./transports.js";
export type { ContentBlock, Transport } from "@modelcontextprotocol/client";

const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

const TIMEOUT_MS = 30_000;
/** Under the 120 s turn lease the stores default to, which isn't renewed while a tool runs. */
const MAX_TOTAL_MS = 90_000;
/** Past the longest timer Node keeps, it fires after about a millisecond. */
const MAX_TIMER_MS = 2_147_483_647;
/** What the SDK's errors about a tool's output schema say, as of @modelcontextprotocol/client 2.4. */
const OUTPUT_SCHEMA = /output ?schema/i;

export interface McpServerOptions {
  /** Names the server in errors and warnings, as in `github/search_issues`. */
  name: string;
  /**
   * Makes a connection: called by the first `connect()` or call, and again
   * for each reconnect. `http(url)` and `stdio({ command })` make one.
   */
  transport: () => Transport | Promise<Transport>;
  /**
   * How long the server may go without answering a call or reporting progress
   * on it, in milliseconds. Also bounds making the transport, connecting and
   * listing tools. Default 30,000.
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
   * The conversation the call is for. Nothing reads it yet: it is here so a
   * later version can pick a connection per user without calls changing.
   */
  readonly conversationId?: string;
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
   * otherwise, and fails with the same error.
   */
  connect(): Promise<void>;
  /** Closes the connection, and stops a `stdio` server. Final: a later call fails with reason `closed`. */
  close(): Promise<void>;
}

/** The connection to an MCP server. Nothing connects until `connect()` or the first call. */
export function mcpServer(options: McpServerOptions): McpConnection {
  return new Connection(options);
}

const MESSAGES: Record<McpErrorReason, (who: string) => string> = {
  args: (who) => `${who} was not called: its args do not match the schema`,
  result: (who) => `${who} returned a result that does not match the schema`,
  timeout: (who) => `${who} did not answer in time`,
  connection: (who) => `${who} could not be reached`,
  protocol: (who) => `${who} was refused by the server`,
  closed: (who) => `${who}: the connection was closed`,
};

class Connection implements McpConnection {
  readonly name: string;
  private readonly options: McpServerOptions;
  private readonly timeoutMs: number;
  private readonly maxTotalMs: number;
  /** The connected client, or null between connections. */
  private client: Client | null = null;
  private dialing: Promise<Client> | null = null;
  /** While a connection is being made: its client, once there is one, so `close()` can stop it. */
  private connecting: Client | null = null;
  /** While `transport()` is pending: gives up on it, for `close()`. */
  private abandon: (() => void) | null = null;
  private closed = false;
  /** Clients whose connection has gone. */
  private readonly dropped = new WeakSet<Client>();
  /** The server's tools at the last listing, by name. Null until a first connect passes the check. */
  private listed: Map<string, ServerTool> | null = null;
  /** The tools `tool()` declared: the only ones that can be called. */
  private readonly declared = new Set<string>();

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
    if (this.listed) {
      const problem = problemWith(name, this.listed);
      if (problem) throw new Error(`${this.name}: ${problem}`);
    }
    this.declared.add(name);
    return Object.freeze({
      server: this.name,
      name,
      call: (args: unknown, ctx?: McpCallCtx) => this.call(name, def, args, ctx),
    });
  }

  async connect(): Promise<void> {
    await this.open();
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.client = null;
    // a connection still being made is stopped where it is, and sees `closed`
    this.abandon?.();
    await this.connecting?.close().catch(() => {});
    await this.dialing?.catch(() => {});
    await client?.close();
  }

  private open(): Promise<Client> {
    if (this.closed) return Promise.reject(this.error("closed", undefined));
    if (this.client) return Promise.resolve(this.client);
    // one connection at a time: calls that arrive meanwhile share it
    this.dialing ??= this.dial().finally(() => {
      this.dialing = null;
      this.connecting = null;
    });
    return this.dialing;
  }

  /**
   * What `transport()` makes, within `timeoutMs` and unless `close()` comes
   * first. A transport made after that is closed when it comes.
   */
  private async made(): Promise<Transport> {
    const making = Promise.resolve().then(() => this.options.transport());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no transport within ${this.timeoutMs} ms`)), this.timeoutMs);
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
    let client: Client | undefined;
    try {
      const transport = await this.made();
      const self: Client = new Client(
        { name: "haikit", version: VERSION },
        {
          // No capabilities are advertised, so a server has no reason to ask
          // this client for input; one that does gets the call refused,
          // rather than a reply nobody wrote.
          inputRequired: { autoFulfill: false },
          ...(this.options.versionNegotiation === undefined
            ? {}
            : { versionNegotiation: { mode: this.options.versionNegotiation } }),
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
      self.onclose = () => {
        this.dropped.add(self);
        if (this.client === self) this.client = null;
      };
      await self.connect(transport, { timeout: this.timeoutMs });
    } catch (err) {
      await client?.close().catch(() => {});
      throw this.error(this.closed ? "closed" : "connection", undefined, { cause: err });
    }

    let tools: ServerTool[];
    try {
      ({ tools } = await client.listTools(undefined, { timeout: this.timeoutMs }));
    } catch (err) {
      await client.close().catch(() => {});
      throw this.failure(err, undefined, client);
    }

    if (this.listed === null) {
      const listing = new Map(tools.map((t) => [t.name, t]));
      const problems = [...this.declared].flatMap((name) => problemWith(name, listing) ?? []);
      if (problems.length) {
        await client.close().catch(() => {});
        throw new Error(`${this.name}: ${problems.join("; ")}`);
      }
      this.listed = listing;
    } else {
      this.compare(tools);
    }

    if (this.closed) {
      await client.close().catch(() => {});
      throw this.error("closed", undefined);
    }
    if (this.dropped.has(client)) throw this.error("connection", undefined);
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
    for (const name of this.declared) {
      const was = before.get(name);
      const now = next.get(name);
      if (!was) continue;
      if (!now) removed.push(name);
      else if (shape(was) !== shape(now)) changed.push(name);
    }
    if (!removed.length && !changed.length) return;
    try {
      (this.options.onChange ?? warn)({ server: this.name, removed, changed });
    } catch (err) {
      console.error(err);
    }
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
    let result: CallToolResult;
    try {
      let client: Client;
      try {
        client = await this.until(deadline.signal, tool, this.open());
      } catch (err) {
        // named again for this call, with what the server said; the
        // declared-tool check throws as it is
        if (!isMcpError(err) || err.tool === tool) throw err;
        throw this.error(err.reason, tool, { cause: err.cause ?? err, text: err.text, code: err.code });
      }
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
        throw this.failure(err, tool, client);
      }
    } finally {
      clearTimeout(timer);
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

  /** What `promise` resolves to, or a timeout for `tool` if `signal` aborts first. */
  private until<T>(signal: AbortSignal, tool: string, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const stop = () => reject(this.error("timeout", tool));
      signal.addEventListener("abort", stop, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
  }

  /** An SDK error, as one of ours. */
  private failure(err: unknown, tool: string | undefined, client: Client): McpError {
    if (isMcpError(err)) return err;
    if (this.closed) return this.error("closed", tool, { cause: err });
    if (err instanceof ProtocolError) {
      // The SDK's own check of a structured result against the output schema
      // the server declared throws one too: the server's result is at fault
      // there, not the call.
      const reason = OUTPUT_SCHEMA.test(err.message) ? "result" : "protocol";
      return this.error(reason, tool, { cause: err, text: err.message, code: err.code });
    }
    if (err instanceof SdkError) {
      switch (err.code) {
        case SdkErrorCode.RequestTimeout:
          return this.error("timeout", tool, { cause: err });
        case SdkErrorCode.NotConnected:
        case SdkErrorCode.ConnectionClosed:
        case SdkErrorCode.SendFailed:
        case SdkErrorCode.ClientHttpFailedToOpenStream:
          return this.error("connection", tool, { cause: err });
        case SdkErrorCode.InvalidResult:
          return this.error("result", tool, { cause: err });
        default:
          return this.error("protocol", tool, { cause: err, text: err.message });
      }
    }
    // the SDK throws a plain Error for a call on a connection that has gone
    return this.error(this.dropped.has(client) ? "connection" : "protocol", tool, { cause: err });
  }

  private error(reason: McpErrorReason, tool: string | undefined, detail: { cause?: unknown; text?: string; code?: number } = {}) {
    const who = tool === undefined ? this.name : `${this.name}/${tool}`;
    return new McpError(reason, MESSAGES[reason](who), { server: this.name, tool, ...detail });
  }
}

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
  console.warn(`@haikit/mcp: ${change.server}: ${parts.join("; ")}`);
}
