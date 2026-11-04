# MCP servers

`@haikit/mcp` lets a HaiKIT tool call the tools of an MCP server. The model
never sees an MCP tool. An app declares the server tools it may call, typed
by schemas it owns, and calls them from a tool's `run` or an action handler,
as it would call a database. That code decides what the model hears of a
result, and what the browser shows. Nothing a third-party server says reaches
the model unless app code puts it there: not its tools' names or
descriptions, not its instructions, and not its results.

Exported by `@haikit/mcp`: `mcpServer`, `McpServerOptions`, `McpConnection`,
`McpToolDef`, `McpTool`, `McpCallCtx`, `McpResult`, `McpToolChange`,
`createMcpAuth`, `McpAuthOptions`, `McpAuth`, `McpServerAuth`,
`McpError`, `McpErrorReason`, `McpAuthNeed`, `McpToolError`, `isMcpError`,
`isMcpToolError`, `http`, `HttpOptions`, `stdio`, `textOf`, `TextOptions`,
and, re-exported from `@modelcontextprotocol/client`, the types
`AuthProvider`, `ContentBlock` and `Transport`.

Checked against `@haikit/*` 0.32.0 and `@modelcontextprotocol/client` 2.4.0.
Source: `packages/mcp/src/index.ts`, `packages/mcp/src/auth.ts`,
`packages/mcp/src/errors.ts`, `packages/mcp/src/text.ts` and
`packages/mcp/src/transports.ts`.

- [The rule](#the-rule): the model never sees an MCP tool
- [`mcpServer`](#mcpserver): `McpServerOptions`
- [`McpConnection`](#mcpconnection): `tool`, `McpToolDef`, `connect`,
  `forget`, `close`
- [A call](#a-call): `McpTool`, `call`, `McpCallCtx`, `McpResult`
- [Errors](#errors): `McpError`, `McpErrorReason`, `McpAuthNeed`,
  `McpToolError`, `isMcpError`, `isMcpToolError`, and what the model hears
  of one
- [The connection](#the-connection): connecting, reconnecting, what this
  client tells a server
- [Calls as each user](#calls-as-each-user): `createMcpAuth`,
  `McpAuthOptions`, `McpAuth`, `bearer`, `McpServerAuth`, who a call runs
  as, each user's connection
- [Changes to the server's tools](#changes-to-the-servers-tools):
  `McpToolChange`, `onChange`
- [Transports](#transports): `http`, `HttpOptions`, `stdio`, `Transport`
- [`textOf`](#textof): `TextOptions`, `ContentBlock`
- [Security](#security)
- [Limits](#limits)

## The rule

```ts
import { mcpServer, http } from "@haikit/mcp";

const github = mcpServer({
  name: "github",
  transport: http("https://api.example.com/mcp", { headers: { Authorization: `Bearer ${token}` } }),
});
const searchIssues = github.tool("search_issues", {
  args: z.object({ q: z.string() }),
  result: z.object({ items: z.array(Issue) }),
});

const findIssues = defineTool({
  name: "find_issues",
  description: "Search this project's issues.",
  input: z.object({ query: z.string() }),
  inputJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async run({ query }, ctx) {
    const { items } = await searchIssues.call({ q: `repo:acme/app ${query}` }, ctx);
    return ctx.render(issueList, { issues: items });
  },
});

await github.connect();
const hai = createHai({ tools: [findIssues], /* … */ });
```

The model is offered `find_issues`, with the description and schema the app
wrote. It hears the surface's digest, and the browser gets the rows. The
server's `search_issues`, its description and its schema are never in a
model request.

There is no way to make a HaiKIT [`Tool`](tools.md#declaring-a-tool) from an MCP tool.
An `McpTool` has no `run`, `description`, `input`, `inputJsonSchema` or
`strict`, so `createHai({ tools })` won't take one. `npm run typetest`
asserts that, in `packages/mcp/test/types/guarantees.ts`.

The package imports only `@haikit/core`, like the model adapters.

## `mcpServer`

```ts
function mcpServer(options: McpServerOptions): McpConnection;

interface McpServerOptions {
  name: string;
  transport: (authProvider?: AuthProvider) => Transport | Promise<Transport>;
  auth?: McpServerAuth;
  maxConnections?: number;
  idleMs?: number;
  timeoutMs?: number;
  maxTotalMs?: number;
  onChange?: (change: McpToolChange) => void;
  versionNegotiation?: VersionNegotiationMode;
}
```

The connection to one MCP server. Nothing connects until
[`connect()`](#connect) or the first call.

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | Names the server in errors and warnings, as in `github/search_issues` |
| `transport` | required | Makes a connection. Called by the first `connect()` or call, and again for each reconnect, so it must make a new `Transport` each time. [`http(url)`](#http) and [`stdio({ command })`](#stdio) return one. For a server with `auth`, it must be what `http()` returned, and is given the `AuthProvider` of the user each connection is for |
| `auth` | none: every call shares one connection, and one identity | Makes each call as the user it runs for, with their own credential, over a connection of their own: `createMcpAuth({ userOf }).bearer(token)`. See [Calls as each user](#calls-as-each-user) |
| `maxConnections` | `100`, with `auth` | The most users connected at once. Past it, the least recently used connections with no call in flight are closed. Only with `auth` |
| `idleMs` | `300_000` (5 min), with `auth` | A user's connection is closed after this long with no call. Only with `auth` |
| `timeoutMs` | `30_000` (30 s) | How long the server may go without answering a call or reporting progress on it. It also bounds making the transport, connecting, listing the server's tools and, with `auth`, looking up a user's token |
| `maxTotalMs` | `90_000` (90 s) | The longest a call may take, progress or not, connecting included |
| `onChange` | a `console.warn` | Hears that a declared tool was removed, or its schema changed. See [Changes to the server's tools](#changes-to-the-servers-tools) |
| `versionNegotiation` | `"legacy"`, the SDK's default | Passed to the SDK as `versionNegotiation: { mode }`. `"legacy"` connects with the 2025 handshake; `"auto"` asks the server first which protocol revision it speaks; `{ pin: "<revision>" }` speaks only that one |

**Throws:**

- `TypeError: name must be a non-empty string`, when `name` isn't a string,
  or is `""`.
- `TypeError: transport must be a function that makes a Transport, such as
  http(url) or stdio({ command })`.
- `RangeError: timeoutMs must be a whole number of milliseconds, from 1 to
  2147483647 (got <value>)`, and the same for `maxTotalMs`: for a value that
  isn't a number, isn't whole, or is out of that range. 2147483647 is the
  longest timer Node keeps.
- `TypeError: maxConnections and idleMs are for a server with auth: without
  it, every call shares one connection`, for either without `auth`.

With `auth`, in this order:

- `TypeError: auth must come from createMcpAuth(), such as
  mcpAuth.bearer(token)`, for anything an `McpAuth` didn't make, even an
  object of the same shape.
- `TypeError: auth needs a transport made by http(url): stdio() and other
  transports can't carry each user's credential`.
- `TypeError: auth gives the transport each user's credential: http() can't
  be given an authProvider as well`.
- `TypeError: auth sets each user's Authorization header: http() can't send
  one of its own as well`, for an `Authorization` header, in any case, in
  `http()`'s `headers` or `requestInit.headers`.
- `RangeError: maxConnections must be a whole number, 1 or more (got
  <value>)`.
- The `RangeError` above for `idleMs`: `idleMs must be a whole number of
  milliseconds, from 1 to 2147483647 (got <value>)`.
- `TypeError: another server from the same createMcpAuth is named
  "<name>"`, while that server is open: a server's name keys its users'
  credentials. It is checked last, so a server refused for anything else
  leaves the name free, and [`close()`](#close) frees it.

## `McpConnection`

```ts
interface McpConnection {
  readonly name: string;
  tool<A, R>(name: string, def: McpToolDef<A, R> & { result: Schema<R> }): McpTool<A, R>;
  tool<A>(name: string, def: McpToolDef<A, unknown> & { result?: undefined }): McpTool<A, McpResult>;
  connect(userId?: string): Promise<void>;
  forget(userId: string): Promise<void>;
  close(): Promise<void>;
}
```

`name` is `McpServerOptions.name`.

### `tool`

```ts
tool<A, R>(name: string, def: McpToolDef<A, R> & { result: Schema<R> }): McpTool<A, R>;
tool<A>(name: string, def: McpToolDef<A, unknown> & { result?: undefined }): McpTool<A, McpResult>;

interface McpToolDef<A, R> {
  args: Schema<A>;
  result?: Schema<R>;
  timeoutMs?: number;
  maxTotalMs?: number;
}
```

Declares one of the server's tools, by its name on the server. Declaring a
tool is the only way to call it, so the declarations are the app's allowlist.
There is no untyped call by name.

| Field | Default | Meaning |
| --- | --- | --- |
| `args` | required | A [`Schema`](surfaces.md#schemas) for the args. `call` parses them with it before anything is sent |
| `result` | none | A `Schema` for the result. With one, `call` resolves to what it parses (see [What a call resolves to](#what-a-call-resolves-to)). Without one, `call` resolves to the result's content, as the server sent it |
| `timeoutMs` | the server's | This tool's `timeoutMs` |
| `maxTotalMs` | the server's | This tool's `maxTotalMs` |

**Returns** an `McpTool`: a frozen object with `server`, `name` and `call`.

The same tool may be declared more than once, such as once with a `result`
schema and once without. Each declaration calls the same server tool.

A result type can only come from a `result` schema: naming `R` without one,
as in `tool<A, R>(name, { args })`, doesn't compile.

**Throws:**

- `TypeError: a tool's name must be a non-empty string`.
- `TypeError: tool "<name>" needs an args schema: anything with a parse
  method`.
- `TypeError: tool "<name>" has a result schema with no parse method`.
- The `RangeError` of [`mcpServer`](#mcpserver) for a `timeoutMs` or
  `maxTotalMs` out of range.
- Declared after a first [`connect`](#connect) has succeeded, the tool is
  checked against the server's latest list of tools at once, even if a tool
  of that name was declared and checked before, and the
  `Error` `connect` would throw is thrown here: `<server>: the server has no
  tool named "<name>"`, or `<server>: tool "<name>" can only run as an MCP
  task, which @haikit/mcp does not support`.

On a server with `auth`, `tool()` doesn't check: each user's connection has
its own list of tools. A tool declared after a user's connection was checked
is checked on that user's first call to it, which rejects with that same
`Error` (see [Each user's connection](#each-users-connection)).

### `connect`

```ts
connect(userId?: string): Promise<void>;
```

Connects, and checks every declared tool. Call it at startup, after
declaring the tools, so a mistake stops the app there. Without it, the first
call connects, and fails with the same error.

On a server with `auth`, `connect(userId)` makes that user's connection, and
checks the tools that user sees, as their first call would: such as just
after the user has given the app their key. Their credential is looked up
first (see [`bearer`](#bearer)), and nothing is sent without one. The
connection is then kept as the user's, as a call's would be (see
[Each user's connection](#each-users-connection)).

1. `transport()` is called, and must make its `Transport` within
   `timeoutMs`. One made later is closed when it comes. An SDK `Client`
   connects over it, within `timeoutMs`. See [The connection](#the-connection)
   for what the client tells the server.
2. The server's tools are listed, every page of them, within `timeoutMs`.
3. On the first connection, each declared tool is checked: the server must
   have a tool of that name, and it mustn't be one that can only run as an
   MCP task (`execution.taskSupport: "required"`). A tool whose task support
   is `"optional"` is called as a plain call.

Resolves once connected and checked. Connected already, it resolves at once.
Calls and `connect()`s that arrive while a connection is being made share
it.

**Rejects:**

| When | With |
| --- | --- |
| `transport()` throws or rejects, or the SDK can't connect | `McpError`, reason `connection`: `<server> could not be reached`, its `cause` the error |
| `transport()` makes nothing within `timeoutMs` | `McpError`, reason `connection`, its `cause` `Error: no transport within <timeoutMs> ms` |
| Listing the tools fails | `McpError`, its reason as for a call (see [Errors](#errors)), named for the server alone, such as `<server> did not answer in time`. Never `result`: a listing the SDK can't read is `protocol`, with the SDK's words on `text` |
| A declared tool fails the check | `Error`: `<server>: ` then each problem, in the order the tools were declared, joined by `; `. A problem is `the server has no tool named "<name>"`, or `tool "<name>" can only run as an MCP task, which @haikit/mcp does not support` |
| `close()` was called, before or while connecting | `McpError`, reason `closed`: `<server>: the connection was closed` |
| With `auth`: the user's credential is missing, refused, or needs more access | `McpError`, reason `auth`: `<server>: the user has not connected an account`, `<server>: the server refused the user's credential`, or `<server>: the user's account needs more access` (see [`McpAuthNeed`](#mcpauthneed)) |
| With `auth`: `token(userId)` throws or rejects, or gives nothing within `timeoutMs` | `McpError`, reason `connection`: `<server> could not be reached`, its `cause` what it threw, or `Error: no token within <timeoutMs> ms` |
| With `auth`, and no `userId`, or `""` | `TypeError: connect() needs a userId for a server with auth: each user's connection is checked as it's made` |
| Without `auth`, and a `userId` | `TypeError: connect() takes a user only for a server with auth` |

After any rejection the connection is closed and nothing is kept, so the
next `connect()` or call starts again from step 1. Only the first connection
to succeed is checked; see [The connection](#the-connection) for later ones.
With `auth`, that is each user's first.

### `forget`

```ts
forget(userId: string): Promise<void>;
```

For a server with `auth`: closes the user's connection, if they have one,
and resolves once it is closed. A call in flight on it rejects with reason
`closed`, and so does a call or `connect(userId)` still waiting for the
user's token, without waiting for it. The user's next call makes a new connection, checked as a first
one, and looks up their credential again. Call it when the user takes their
key away, or the app has a new one for them.

For a user with no connection, it resolves at once.

**Rejects:**

- `TypeError: forget() is for a server with auth: without it, every call
  shares one connection`.
- `TypeError: forget() needs a userId`, for one that isn't a non-empty
  string.

### `close`

```ts
close(): Promise<void>;
```

Closes the connection, and resolves once it is closed. Called again, it
returns the first call's promise, so every `close()` resolves only then.
A `stdio` server is sent end-of-input, then `SIGTERM` after 2 s, then
`SIGKILL` after 2 s more (the SDK's `StdioClientTransport.close`).

A connection still being made is stopped where it is: a `transport()` still
pending is given up on, and what it makes later is closed; a client still
connecting, or listing the tools, is closed. The `connect()` or call waiting
on it rejects with reason `closed`, and so does a call in flight. It is final: every later call rejects with
`McpError`, reason `closed`, `<server>/<tool>: the connection was closed`,
without connecting, and `connect()` with `<server>: the connection was
closed`.

With `auth`, it closes every user's connection the same way. A call still
waiting for `userOf`, or for a user's token, rejects with reason `closed`
without waiting for it. A later call rejects with reason `closed` without
looking up who it's for, and the
server's `name` is free again for another server from the same
`createMcpAuth`.

## A call

### `McpTool`

```ts
interface McpTool<A, R> {
  readonly server: string;
  readonly name: string;
  call(args: A, ctx?: McpCallCtx): Promise<R>;
}
```

One of the server's tools, as the app declared it: `server` is the server's
`name`, and `name` the tool's. It is not a HaiKIT `Tool`.

### `call`

```ts
call(args: A, ctx?: McpCallCtx): Promise<R>;
```

1. **The args are parsed** with the `args` schema. If it throws, the call
   rejects with `McpError`, reason `args`: `<server>/<tool> was not called:
   its args do not match the schema`, its `cause` what the schema threw.
   What it returns must be an object, not an array or `null`, or the call
   rejects with reason `args`: `<server>/<tool> was not called: its args
   must be an object`. Nothing is sent either way.
2. **With `auth`, the user is found** (see
   [Who a call runs as](#who-a-call-runs-as)), and the call takes their
   connection. If there is no one to call as, the call rejects with reason
   `user`, and nothing is sent. Looking up counts against `maxTotalMs`.
3. **It connects,** if it isn't connected, as [`connect`](#connect) does.
   With `auth`, the user's credential is looked up first, if their
   connection has none, and a user with none rejects with reason `auth`,
   kind `connect`, before anything is sent. A failure rejects the call with
   the same reason, named for the call, as in `<server>/<tool> could not be
   reached`, and the same `cause`, `text`, `code` and `auth`. The `Error` of
   a declared tool failing the check rejects the call as it is, and so does
   that of a tool declared after the user's connection was checked, on the
   user's first call to it. Connecting counts against `maxTotalMs`: a call
   still waiting for the connection when it runs out rejects with reason
   `timeout`, and the connection goes on being made for the calls after it.
4. **The tool is called** (`tools/call`) with the parsed args.
   - It times out after `timeoutMs` with no answer and no progress, and once
     `maxTotalMs` has passed since the call began, connecting included.
     Either way the server is sent `notifications/cancelled` for it.
   - Progress is always asked for, so a server that reports it keeps a long
     call alive whether or not a `ctx` hears it. Each progress notification
     starts `timeoutMs` again.
   - Each one reaches `ctx.progress`, if there is one, as `{ done: progress,
     total, message }`, with `total` and `message` only when the server sent
     them. In a HaiKIT tool, that sends the browser a `progress` event (see
     [Tools: `progress`](tools.md#progress)).
   - With `auth`, a 401 from the server has the transport look up the
     user's token again, and send the request once more (see
     [`bearer`](#bearer)). That is the SDK's retry of one HTTP request, not a
     second call: a request the server refused with a 401 wasn't run.
5. **The result is decided** (see below).

A call is sent once. One that fails is never sent again on its own, even
when a reconnect follows: the server may have run it.

### What a call resolves to

| The server's result | `call` |
| --- | --- |
| `isError: true` | Rejects with [`McpToolError`](#mcptoolerror) |
| No `result` schema | Resolves to `{ content }`, or `{ content, structuredContent }` when the server sent structured content: as sent, unchecked |
| A `result` schema, and structured content | Resolves to `result.parse(structuredContent)` |
| A `result` schema, no structured content, and exactly one content block, of type `text` | Resolves to `result.parse(JSON.parse(text))` |
| A `result` schema, and neither | Rejects with `McpError`, reason `result`; its `cause` is `Error: the result has no structured content, and isn't one text block` |

With a `result` schema, text that isn't JSON, or a value the schema throws
on, rejects with reason `result`: `<server>/<tool> returned a result that
does not match the schema`, its `cause` the `SyntaxError` or what the schema
threw.

The SDK checks structured content against the output schema the server
declared for the tool, and refuses a result that doesn't match it, or has
none when one is declared. That rejects with reason `result` too, with the
SDK's words on `text`. It is told apart by the SDK's code and words for
those checks, as of `@modelcontextprotocol/client` 2.4:

- `-32600`, `Tool <tool> has an output schema but did not return structured content`;
- `-32602`, `Structured content does not match the tool's output schema: …`;
- `-32602`, `Failed to validate structured content: …`.

An error the server sends is reason `protocol`, whatever it says, unless it
has one of those codes and words. So is a declared output schema the SDK
can't compile (`Tool '<tool>' has an invalid outputSchema: …`), which
rejects the call before it is sent.

### `McpCallCtx`

```ts
interface McpCallCtx {
  readonly conversationId?: string;
  readonly userId?: string;
  progress?(progress: Progress): void;
}
```

What a call is made for. A HaiKIT tool's [`ToolCtx`](tools.md#toolctx) or an
action handler's [`ActionCtx`](surfaces.md) can be passed as it is. On a
server without `auth`, so can nothing at all, as from a background job.

| Field | Meaning |
| --- | --- |
| `conversationId` | With `auth`: the call runs as this conversation's owner, from `userOf`. A HaiKIT `ctx` has it (see [Tools: `conversationId`](tools.md#conversationid)). Not read without `auth` |
| `userId` | With `auth`: the user to call as, for a call made outside any conversation, such as a job. With a `conversationId` too, it must be the conversation's owner. Not read without `auth` |
| `progress` | Hears the server's progress notifications, as described in step 4 above |

See [Who a call runs as](#who-a-call-runs-as).

### `McpResult`

```ts
interface McpResult {
  content: ContentBlock[];
  structuredContent?: unknown;
}
```

What `call` resolves to without a `result` schema: the content blocks, and
the structured content when the server sent some, unchecked. `ContentBlock`
is the SDK's type, re-exported. [`textOf`](#textof) makes text of one.

## Errors

A call either resolves, or rejects with one of two errors, or with the
plain `Error` of the declared-tool check. The messages name only the server
and the tool, never what the server said. What it said is on `text`.

### `McpError`

```ts
class McpError extends Error {
  readonly name: "McpError";
  readonly server: string;
  readonly tool: string | undefined;
  readonly reason: McpErrorReason;
  readonly text: string | undefined;
  readonly code: number | undefined;
  readonly auth: McpAuthNeed | undefined;
}

type McpErrorReason = "args" | "result" | "timeout" | "connection" | "protocol" | "closed" | "user" | "auth";
```

A call that got no result, or one its schema refused.

| Field | Meaning |
| --- | --- |
| `server` | The server's `name` |
| `tool` | The tool called. `undefined` when `connect()` failed |
| `reason` | Why; see below |
| `text` | What the server, or the SDK, said about it, when it said anything: a JSON-RPC error's message, or the SDK's own |
| `code` | A JSON-RPC error's code, such as `-32602` |
| `auth` | With reason `auth`: what the user's credential needs, frozen (see [`McpAuthNeed`](#mcpauthneed)). `undefined` with any other |
| `cause` | The error it came from, when there was one: what a schema threw, or the SDK's error |

| `reason` | When | Message, for a call |
| --- | --- | --- |
| `args` | The `args` schema refused the args, or they aren't an object. Nothing was sent | `<server>/<tool> was not called: its args do not match the schema`, or `… its args must be an object` |
| `result` | The `result` schema refused the result, there was nothing to parse, or the SDK refused it against the server's output schema (see [What a call resolves to](#what-a-call-resolves-to)). Only a call has it: listing the tools never fails with `result` | `<server>/<tool> returned a result that does not match the schema` |
| `timeout` | No answer within `timeoutMs`, or not done within `maxTotalMs`, connecting included | `<server>/<tool> did not answer in time` |
| `connection` | The server couldn't be reached, or the connection dropped before the answer | `<server>/<tool> could not be reached` |
| `protocol` | The server refused the call, as for a tool it doesn't have (`code` `-32602`), whatever its words. Also a listing of tools the SDK can't read, and any other SDK error, such as an HTTP 401 or 403 on a server without `auth`, or a server asking this client for input | `<server>/<tool> was refused by the server` |
| `closed` | `close()` or, with `auth`, [`forget()`](#forget) was called, before or during the call | `<server>/<tool>: the connection was closed` |
| `user` | A server with `auth` had no user to call as (see [Who a call runs as](#who-a-call-runs-as)). Nothing was sent | `<server>/<tool> was not called: there is no user to call it as`, `… the user it runs for could not be looked up`, or `… its userId is not the conversation's owner` |
| `auth` | A server with `auth`: the user's credential is missing, was refused, or needs more access. `auth.kind` says which | `<server>/<tool>: the user has not connected an account` (`connect`), `<server>/<tool>: the server refused the user's credential` (`reconnect`), or `<server>/<tool>: the user's account needs more access` (`scope`) |

From `connect()`, the messages name the server alone: `<server> could not
be reached`, `<server> did not answer in time`, `<server> was refused by the
server`, `<server>: the connection was closed`, and with `auth`,
`<server>: the user has not connected an account` and the rest.

How an SDK error is read, in order: after `close()`, `closed`. On a server
with `auth`, the SDK's `InsufficientScopeError` (a 403 with
`error="insufficient_scope"`) is `auth`, kind `scope`, with its
`requiredScope` as `scope` and its message as `text`; and its
`UnauthorizedError`, or an `SdkHttpError` with code
`ClientHttpAuthentication` (a 401 again, on the transport's retry), is
`auth`, kind `reconnect`, with its message as `text`. A JSON-RPC
error (`ProtocolError`) is `protocol`, with its `code` and its message as
`text`, unless the message is about an output schema, which is the SDK's
check above, and `result`. Of the SDK's own errors (`SdkError`): a timeout
is `timeout`; not connected, connection closed, a failed send, or an HTTP
stream that wouldn't open is `connection`; an invalid result is `result`;
any other is `protocol`, with its message as `text`. Anything else is
`connection` if the connection had dropped, and `protocol` if not.

### `McpAuthNeed`

```ts
interface McpAuthNeed {
  readonly kind: "connect" | "reconnect" | "scope";
  readonly scope?: string;
}
```

What a call with reason `auth` needs from the user, on the error's `auth`.

| `kind` | When | What the user can do |
| --- | --- | --- |
| `connect` | The app has no credential for the user: `token(userId)` gave `null`. Nothing was sent | Give the app one, such as their key |
| `reconnect` | The server refused theirs: a 401, and again after the transport looked up the token once more, or that lookup found none | Give the app a new one |
| `scope` | Theirs needs more access: a 403 with `error="insufficient_scope"` | Grant it more access. `scope` is what the server asked for |

`scope` is there only with kind `scope`, and only when the server's
`WWW-Authenticate` challenge named one, as it put it, such as
`"read write"`.

A tool that catches the error decides what to do with it: such as tell the
model the user must connect an account first, or show a surface that asks
them to.

### `McpToolError`

```ts
class McpToolError extends Error {
  readonly name: "McpToolError";
  readonly server: string;
  readonly tool: string;
  readonly text: string;
  readonly content: ContentBlock[];
}
```

The tool ran, and reported an error: its result had `isError: true`. A
server built with the SDK reports this when its handler throws, and when it
refuses the args against the tool's own input schema.

The message is `<server>/<tool> reported an error`. `text` is the result's
text blocks, joined by newlines, and `content` all its blocks, as sent.

### `isMcpError`, `isMcpToolError`

```ts
const isMcpError: (err: unknown) => err is McpError;
const isMcpToolError: (err: unknown) => err is McpToolError;
```

True for an `Error` whose `name` is `"McpError"`, or `"McpToolError"`. They
test the name rather than the class, as
[`isStaleLease`](conversations.md) does, because a duplicated install of the
package would give two classes.

### What the model hears of one

Nothing, unless the HaiKIT tool lets it through. A tool that catches the
error decides what to say. One that doesn't throws it from `run`, and the
model's tool result is `<tool> failed: <message>` (see
[Tools: how a tool call runs](tools.md#how-a-tool-call-runs)), as in:

```
find_issues failed: github/search_issues could not be reached
```

The server's own words, on `text` and `content`, are not in it.

## The connection

**One at a time.** A connection is one SDK `Client`, over one `Transport`
from `transport()`. Calls share it, and calls that arrive while it is being
made wait for it.

**What this client tells the server:**

- `clientInfo` is `{ name: "haikit", version: <this package's version> }`.
- No client capabilities are advertised: no sampling, no elicitation, no
  roots. So a server has no reason to ask this client for anything.
- The SDK's `inputRequired.autoFulfill` is off. A server on the 2026-07-28
  protocol that answers a call with `input_required` gets the call refused,
  reason `protocol`, rather than a reply nobody wrote.
- `versionNegotiation`, if given.

**When it drops** (a `stdio` server exits, an HTTP session ends), it is
forgotten, and a call in flight rejects with reason `connection`. The next
call or `connect()` makes a new connection, with a new `Client` and a new
`Transport`: one attempt per call. If that fails, the call rejects, and the
one after tries again.

**A new connection is not checked** the way the first was. Its list of
tools is compared with the last one instead, and a change is reported (see
below). A call to a tool the server no longer has rejects with reason
`protocol`.

All of this is for one identity. On a server with `auth`, each user has a
connection of their own that works this way (see
[Each user's connection](#each-users-connection)).

## Calls as each user

```ts
import { createMcpAuth, mcpServer, http } from "@haikit/mcp";

const mcpAuth = createMcpAuth({ userOf: (id) => auth.ownerOf(id) });
const tracker = mcpServer({
  name: "tracker",
  transport: http("https://mcp.tracker.example/mcp"),
  auth: mcpAuth.bearer((userId) => keys.find(userId)),
});
const listIssues = tracker.tool("list_issues", { args: z.object({}) });

// in a HaiKIT tool's run, as the conversation's owner:
await listIssues.call({}, ctx);
// in a job, as a user it names:
await listIssues.call({}, { userId });
```

Without `auth`, every call on a server shares one connection, made with the
app's own credentials, whoever the conversation belongs to. With it, each
call is made as the user it runs for, with that user's own credential, over
a connection of their own. The call's `ctx` says who that is. A call with no
one to run as is refused before anything is sent: it never falls back to the
app's credentials, or anyone else's.

### `createMcpAuth`

```ts
function createMcpAuth(options: McpAuthOptions): McpAuth;

interface McpAuthOptions {
  userOf(conversationId: string): string | null | Promise<string | null>;
}

interface McpAuth {
  bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
}
```

| Option | Meaning |
| --- | --- |
| `userOf` | Who a conversation belongs to: the user a call in it runs as. With `@haikit/auth`, `(id) => auth.ownerOf(id)` (see [Sign-in and ownership: `ownerOf`](auth.md#ownerof)). `null`, or anything but a non-empty string, for no one |

**Returns** a frozen `McpAuth`, which makes the `auth` of each server whose
calls are made as each user. Servers given an `auth` from one `McpAuth` must
have different names (see [`mcpServer`](#mcpserver)).

**Throws** `TypeError: createMcpAuth: userOf must be a function, such as
(id) => auth.ownerOf(id)`.

### `bearer`

```ts
bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
```

Each user's token, which the app already has, such as a key the user gave
it. `token(userId)` gives it, or `null` when the user has none. It is sent as
`Authorization: Bearer <token>` on every request of that user's connection.

- **It's looked up** when the user's connection has none: before its first
  connection, and after the server refused it. It's kept on the connection
  in between, and [`forget(userId)`](#forget) drops it with the connection.
  One lookup runs at a time for each user's connection: first calls made
  together, and 401s that come together, share it, and only it sets the
  token.
- **`null`, `""`, or anything but a non-empty string** means the user has
  none: the call rejects with reason `auth`, kind `connect`, and nothing is
  sent. The next call looks again.
- **If `token` throws or rejects,** the call rejects with reason
  `connection`, `<server>/<tool> could not be reached`, its `cause` what it
  threw. One that gives nothing within `timeoutMs` rejects the same way,
  its `cause` `Error: no token within <timeoutMs> ms`, and the next lookup
  starts afresh.
- **On a 401,** the transport looks it up again with `token(userId)`, and
  sends the request once more with what it gives, so a key the app has
  replaced is picked up without a failed call. `null` from that lookup, or a 401 again, rejects the call with
  reason `auth`, kind `reconnect`, and the token is forgotten: the user's next
  call looks it up again.
- **On a 403 with `error="insufficient_scope"`,** the call rejects with
  reason `auth`, kind `scope`, with the `scope` the server's challenge
  asked for.

**Returns** a frozen `McpServerAuth`, `{ kind: "bearer" }`, for one
`mcpServer`.

**Throws** `TypeError: bearer: token must be a function that takes a user id
and returns their token, or null`.

### `McpServerAuth`

```ts
interface McpServerAuth {
  readonly kind: "bearer";
}
```

How a server's calls are made as each user: made by an `McpAuth`, and given
to `mcpServer({ auth })`. `mcpServer` takes only one an `McpAuth` made, not
an object of the same shape.

### Who a call runs as

From the call's [`McpCallCtx`](#mcpcallctx):

| `conversationId` | `userId` | The call runs as |
| --- | --- | --- |
| a conversation `userOf` gives an owner | none | the owner |
| a conversation `userOf` gives an owner | the owner | the owner |
| a conversation `userOf` gives an owner | anyone else | no one: reason `user`, `<server>/<tool> was not called: its userId is not the conversation's owner` |
| a conversation with no owner | either | no one: reason `user`, `<server>/<tool> was not called: there is no user to call it as` |
| none | a user | that user, for a call made outside any conversation, such as a job |
| none | none | no one: reason `user`, as above |

A `userOf` that throws or rejects rejects the call with reason `user`,
`<server>/<tool> was not called: the user it runs for could not be looked
up`, its `cause` what it threw. `userOf` is called for every call with a
conversation, and its answer isn't kept. A `conversationId` or `userId`
that isn't a non-empty string counts as none.

A `userId` names a user without proof, so it must come from the app's own
code, never from the model or the browser. In a tool's `run`, pass the
`ctx`, and the user is the conversation's owner.

### Each user's connection

Each user has a connection of their own to each server with `auth`, made on
their first call or `connect(userId)`, and kept for their later calls. Each
works as the one connection of a server without `auth` does (see
[The connection](#the-connection)), for that user's identity alone:

- **Its tools are checked** on its first connection, against the tools that
  user sees: a server may show users different tools. A tool declared after
  that is checked on the user's first call to it.
- **A change to its tools** is compared with that user's last list, and
  `McpToolChange.user` says whose (see
  [Changes to the server's tools](#changes-to-the-servers-tools)).
- **Closed for room:** making a user's connection when `maxConnections`
  users (100 by default) have one first closes the least recently used ones
  with no call in flight. One with a call in flight is never closed for
  room: when all are busy, the pool grows past `maxConnections`, and shrinks
  back as each call finishes.
- **Closed when idle,** after `idleMs` (300,000 ms by default) with no call.
  The timer doesn't keep the process alive.
- **Closed by [`forget(userId)`](#forget),** and by [`close()`](#close).

A user whose connection was closed for room, for idling or by `forget` gets
a new one on their next call, checked as a first one, with their credential
looked up again.

## Changes to the server's tools

```ts
interface McpToolChange {
  server: string;
  user?: string;
  removed: string[];
  changed: string[];
}
```

The server's list of tools is read again when the server says it changed
(`notifications/tools/list_changed`; the SDK reads it, after a short
debounce), and on each new connection. Each declared tool in the last list
is compared with the new one:

- **`removed`**: the new list has no tool of that name.
- **`changed`**: its `inputSchema`, its `outputSchema` or its
  `execution.taskSupport` is different, compared as JSON.

Undeclared tools aren't compared, and neither are descriptions: the model
never sees them. Names come in the order the tools were declared. When
either list has a name, `onChange` is called with both. The new list is
kept either way: it's what a later `tool()` is checked against.

On a server with `auth`, each user's connection compares its own lists,
and `user` is the user it is for. Without `auth`, the change has no `user`.

Nothing else changes: the model's tools are the app's, and calls go on as
before. A call to a removed tool rejects with reason `protocol`; one whose
args no longer suit the server gets `McpToolError` from it.

**The default `onChange`** writes one `console.warn`: `@haikit/mcp:
<server>: `, or with a `user`, `@haikit/mcp: <server> (for user <user>): `,
then, joined by `; `, `tool "<name>" was removed` for each
removed tool, and `tool "<name>" changed its schema` for each changed one.

An `onChange` that throws has its error written with `console.error`.

## Transports

`Transport` is the SDK's interface, re-exported. Any function that makes a
new one each time can be `transport`, such as one returning the SDK's
`InMemoryTransport`, in a test. A server with `auth` takes only what
[`http()`](#http) returned.

### `http`

```ts
function http(url: string | URL, options?: HttpOptions): (authProvider?: AuthProvider) => Transport;

interface HttpOptions extends StreamableHTTPClientTransportOptions {
  headers?: Record<string, string>;
}
```

A server at `url`, over Streamable HTTP. Each call of what it returns makes
a new `StreamableHTTPClientTransport`. Given an `authProvider`, that
transport uses it: a server with `auth` gives each user's connection the
`AuthProvider` that sends their credential. `AuthProvider` is the SDK's
interface, re-exported.

| Option | Meaning |
| --- | --- |
| `headers` | Sent on every request. Each is set over one of the same name in `requestInit.headers` |
| everything else | The SDK's `StreamableHTTPClientTransportOptions`, such as `authProvider` for a bearer token from a function, or an OAuth client, and `requestInit` and `fetch` |

The SDK sets some headers itself, over any of these: `Authorization`, when
an `authProvider` gives a token, and the protocol's own.

For a server with `auth`, `http()` must have no `authProvider`, and no
`Authorization` header in `headers` or `requestInit.headers`: each user's
connection sends their own. `mcpServer` refuses one that does (see its
Throws).

**Throws** the `TypeError` of `new URL(url)`, when `http()` is called, for a
URL that doesn't parse: a bad URL fails at startup.

### `stdio`

```ts
function stdio(params: StdioServerParameters): () => Transport;
```

A server this process starts, and talks to over its stdin and stdout.
`params` are the SDK's: `command`, `args`, `env`, `cwd`, `stderr` and
`maxBufferSize`. Each connection starts a new child, and `close()` stops it.

- **Its environment** is the SDK's short list of variables thought safe,
  copied from this process (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and
  `USER`, on Linux and macOS), then `params.env` over them. Nothing else in
  this process's environment, such as its secrets, reaches the child unless
  `env` names it.
- **Its stderr** goes to this process's stderr, unless `stderr` says
  otherwise.

## `textOf`

```ts
function textOf(result: McpResult, options?: TextOptions): string;

interface TextOptions {
  maxChars?: number;
}
```

A result as text, for a tool that decides to pass some of it on. Nothing
calls it for you.

Each content block becomes one piece of text, in order, joined by newlines:

| Block | Text |
| --- | --- |
| `text` | its text |
| `image`, `audio` | `[image: <mimeType>, <n> bytes, not included]`, or `[audio: …]` |
| `resource_link` | `[resource link: <name> <uri>]` |
| `resource`, with text | its text |
| `resource`, with a blob | `[resource: <uri>, <mimeType>, <n> bytes, not included]`, without `, <mimeType>` when it has none |
| any other type | `[<type> content, not included]` |

`<n>` is the size of what the base64 data encodes, worked out from its
length, without decoding it. With no content blocks, the text is the
structured content as JSON, or `""` with none. Structured content is
ignored when there are content blocks.

| Option | Default | Meaning |
| --- | --- | --- |
| `maxChars` | `8_000` (about 2,000 tokens) | Longer text is cut to its first `maxChars` characters, and `\n[Cut at <maxChars> of <length> characters.]` is added, so whoever reads it knows |

**Throws** `RangeError: maxChars must be a whole number of characters, 0 or
more (got <value>)`.

## Security

- **The model hears only what app code gives it.** Tool descriptions and a
  server's instructions are never sent to the model. Results, and an error's
  `text` and `content`, are the server's words: data to decide about, not
  text to pass on unread. If some must reach the model, pass what the app
  checked, such as a parsed `result`, or a cut `textOf`. The model's
  [scope](server.md#scope) tells it tool results are data, not instructions,
  but that is a guard on what it says, not on what it does.
- **Declared tools only.** A call can only reach a tool the app declared, so
  a server that adds a tool later gives the app nothing new.
- **Annotations aren't read.** A server's `readOnlyHint` or
  `destructiveHint` is the server's claim. A tool with consequences needs
  its check in the HaiKIT tool or action handler, where it runs as code.
- **A `stdio` server** gets this process's safe variables, not its secrets
  (see [`stdio`](#stdio)).
- **Whose identity.** Without `auth`, every call on a server is made with
  the same credentials, the app's, whoever the conversation belongs to:
  give such a server only what every user may see and do. With `auth`, a
  call runs as the conversation's owner, or the `userId` of a call outside
  any conversation, over that user's own connection. It never falls back to
  the app's credentials or another user's, and a `userId` that isn't the
  conversation's owner is refused (see
  [Who a call runs as](#who-a-call-runs-as)).
- **A user's token stays with the app.** `bearer`'s token is kept in memory
  on the user's connection, and sent only to that server. It isn't in an
  error's message, and the model never sees it.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| A call with no answer and no progress | 30,000 ms, by default | `timeoutMs` |
| A call in all, connecting included | 90,000 ms, by default | `maxTotalMs` |
| Making the transport, connecting, listing the tools, and with `auth` looking up a user's token | `timeoutMs` each | `connect` |
| Longest `timeoutMs` and `maxTotalMs` | 2,147,483,647 ms | Node's longest timer |
| `textOf` | 8,000 characters, by default | `maxChars` |
| Pages of tools listed | 64 | the SDK's `listMaxPages` |
| One stdio message | 10 MB | the SDK's `maxBufferSize` |
| Connections, without `auth` | 1, shared by every call | |
| Connections, with `auth` | 1 per user; at most `maxConnections`, 100 by default, with no call in flight | `maxConnections` |
| A user's connection with no call is kept | 300,000 ms, by default | `idleMs` |
| Lookups of a user's token at once, for each user's connection | 1, shared by first calls and 401s that come together | [`bearer`](#bearer) |
| Times a call is sent | 1 | |

A call runs inside a turn, which holds the conversation's lease. The lease
lasts 120,000 ms by default (`leaseMs` in [Stores](stores.md)) and isn't
renewed while a tool runs, so a turn's model calls and tool calls together
must finish within it. `maxTotalMs` leaves 30 s of that for the rest.
