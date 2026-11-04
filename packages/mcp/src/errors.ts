import type { ContentBlock } from "@modelcontextprotocol/client";

/**
 * Why a call failed:
 *
 * - `args`: the args didn't match the tool's `args` schema, so nothing was sent.
 * - `result`: the result didn't match its `result` schema.
 * - `timeout`: the server didn't answer within `timeoutMs` or `maxTotalMs`.
 * - `connection`: the server couldn't be reached, or the connection dropped.
 * - `protocol`: the server refused the call, such as for a tool it doesn't
 *   have, or asked for something this client doesn't do.
 * - `closed`: `close()` was called.
 * - `user`: a server with `auth` had no user to call as, so nothing was sent.
 * - `auth`: the user's credential for the server is missing, was refused, or
 *   needs more access. `auth` on the error says which.
 */
export type McpErrorReason = "args" | "result" | "timeout" | "connection" | "protocol" | "closed" | "user" | "auth";

/** What a call with reason `auth` needs from the user. */
export interface McpAuthNeed {
  /**
   * `connect`: the user has no credential for the server, so nothing was sent.
   * `reconnect`: the server refused theirs. `scope`: theirs needs more access.
   */
  readonly kind: "connect" | "reconnect" | "scope";
  /** On `scope`: the scope the server asked for, as its challenge put it. */
  readonly scope?: string;
}

/**
 * A call that didn't get a result. The message names only the server and the
 * tool, never what the server said: a HaiKIT tool that lets this go reaches the
 * model as `<name> failed: <message>`, and the server's words aren't the app's
 * to pass on unread. Its words are on `text`, for logs and for code that
 * decides.
 *
 * Detected by `name` rather than `instanceof`, as in @haikit/core: a duplicated
 * install would give two distinct classes.
 */
export class McpError extends Error {
  readonly name = "McpError";
  /** The server's `name`. */
  readonly server: string;
  /** The tool called. Absent when `connect()` failed. */
  readonly tool: string | undefined;
  readonly reason: McpErrorReason;
  /** What the server said about it, when it said anything: a JSON-RPC error's message. */
  readonly text: string | undefined;
  /** A JSON-RPC error's code. */
  readonly code: number | undefined;
  /** With reason `auth`: what the user's credential needs. */
  readonly auth: McpAuthNeed | undefined;

  constructor(
    reason: McpErrorReason,
    message: string,
    detail: { server: string; tool?: string; text?: string; code?: number; cause?: unknown; auth?: McpAuthNeed },
  ) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.reason = reason;
    this.server = detail.server;
    this.tool = detail.tool;
    this.text = detail.text;
    this.code = detail.code;
    this.auth = detail.auth === undefined ? undefined : Object.freeze({ ...detail.auth });
  }
}

/**
 * The tool ran and reported an error (`isError` in its result). Its message
 * says only that, for the reason `McpError`'s does; what the server said is on
 * `text` and `content`.
 */
export class McpToolError extends Error {
  readonly name = "McpToolError";
  readonly server: string;
  readonly tool: string;
  /** The result's text blocks, joined by newlines. */
  readonly text: string;
  /** The result's content blocks, as the server sent them. */
  readonly content: ContentBlock[];

  constructor(server: string, tool: string, content: ContentBlock[]) {
    super(`${server}/${tool} reported an error`);
    this.server = server;
    this.tool = tool;
    this.content = content;
    this.text = content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  }
}

export const isMcpError = (err: unknown): err is McpError => err instanceof Error && err.name === "McpError";

export const isMcpToolError = (err: unknown): err is McpToolError =>
  err instanceof Error && err.name === "McpToolError";
