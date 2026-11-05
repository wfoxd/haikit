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
`OAuthServerOptions`, `McpConnected`, `McpAccount`, `CredentialStore`,
`memoryCredentialStore`, `McpError`, `McpErrorReason`, `McpAuthNeed`,
`McpToolError`, `isMcpError`, `isMcpToolError`, `http`, `HttpOptions`,
`stdio`, `textOf`, `TextOptions`, and, re-exported from
`@modelcontextprotocol/client`, the types `AuthProvider`,
`OAuthClientProvider`, `ContentBlock` and `Transport`. Exported by
`@haikit/mcp/postgres`: `pgCredentialStore`, `migrate`, `schema` and
`Queryable`.

Checked against `@haikit/*` 0.33.0 and `@modelcontextprotocol/client` 2.4.0.
Source, in `packages/mcp/src/`: `index.ts`, `auth.ts`, `credential.ts`,
`oauth.ts`, `routes.ts`, `store.ts`, `seal.ts`, `postgres.ts`, `errors.ts`,
`text.ts` and `transports.ts`.

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
  `McpAuthOptions`, `McpAuth`, `bearer`, `oauth`, `OAuthServerOptions`,
  `sdk`, `connections`, `McpAccount`, `disconnect`, `McpServerAuth`, who a
  call runs as, each user's connection
- [The routes](#the-routes): `handler`, connecting, the callback,
  `McpConnected`, the done page, disconnecting, the user's connections, the
  client metadata document
- [Credential stores](#credential-stores): `CredentialStore`,
  `memoryCredentialStore`, `@haikit/mcp/postgres`, sealing
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
| `auth` | none: every call shares one connection, and one identity | Makes each call as the user it runs for, with their own credential, over a connection of their own: `mcpAuth.bearer(token)`, `mcpAuth.oauth()` or `mcpAuth.sdk(make)`, from [`createMcpAuth`](#createmcpauth). See [Calls as each user](#calls-as-each-user) |
| `maxConnections` | `100`, with `auth` | The most users connected at once. Past it, the least recently used connections with no call in flight are closed. Only with `auth` |
| `idleMs` | `300_000` (5 min), with `auth` | A user's connection is closed after this long with no call. Only with `auth` |
| `timeoutMs` | `30_000` (30 s) | How long the server may go without answering a call or reporting progress on it. It also bounds making the transport, connecting, listing the server's tools and, with `auth`, looking up a user's credential. For `oauth()`, it bounds each request to an authorization server, and each refresh |
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
first (see [`bearer`](#bearer), [`oauth`](#oauth) and [`sdk`](#sdk)), and
nothing is sent without one. An `auth` error from it has a connect link
with no conversation (see [`McpAuthNeed`](#mcpauthneed)). The
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
| With `auth`: the user's credential can't be looked up: `token(userId)`, `make(userId)` or the store throws or rejects, or gives nothing within `timeoutMs` | `McpError`, reason `connection`: `<server> could not be reached`, its `cause` what it threw, or `Error: no token within <timeoutMs> ms` (`no credential …` for `oauth()`, `no provider …` for `sdk()`) |
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
user's credential, without waiting for it. The user's next call makes a new connection, checked as a first
one, and looks up their credential again. Call it when the user takes their
key away, or the app has a new one for them. For an `oauth()` server, the
callback and [`disconnect`](#disconnect) call it for you.

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
waiting for `userOf`, or for a user's credential, rejects with reason `closed`
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
     user's token again, or for `oauth()` refresh it, and send the request
     once more (see [`bearer`](#bearer) and [`oauth`](#oauth)). That is the
     SDK's retry of one HTTP request, not a second call: a request the
     server refused with a 401 wasn't run.
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
| `conversationId` | With `auth`: the call runs as this conversation's owner, from `userOf`. A HaiKIT `ctx` has it (see [Tools: `conversationId`](tools.md#conversationid)). On an `oauth()` server, an `auth` error's connect link names it, so `onConnected` can wake it. Not read without `auth` |
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
| `connection` | The server couldn't be reached, or the connection dropped before the answer. With `auth`, also: the user's credential couldn't be looked up, or for `oauth()`, refreshed, as when the authorization server couldn't be reached, or answered with something other than a refusal, or found the user connected again as the call was made | `<server>/<tool> could not be reached` |
| `protocol` | The server refused the call, as for a tool it doesn't have (`code` `-32602`), whatever its words. Also a listing of tools the SDK can't read, and any other SDK error, such as an HTTP 401 or 403 on a server without `auth`, or a server asking this client for input. For `oauth()`, also a server that now names an authorization server other than the one that issued the user's credential | `<server>/<tool> was refused by the server` |
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
  readonly connect?: string;
}
```

What a call with reason `auth` needs from the user, on the error's `auth`.

| `kind` | When | What the user can do |
| --- | --- | --- |
| `connect` | The app has no credential for the user: `token(userId)` or `make(userId)` gave `null`, or for `oauth()`, the store has none that opens. Nothing was sent | Give the app one, such as their key, or for `oauth()`, connect at `connect` |
| `reconnect` | The server refused theirs: a 401, and again after the transport looked up the token once more, or that lookup found none. For `oauth()`: a 401 again after a refresh, a refresh the authorization server refused, or a credential with no refresh token | Give the app a new one, or for `oauth()`, connect again at `connect` |
| `scope` | Theirs needs more access: a 403 with `error="insufficient_scope"` | Grant it more access, or for `oauth()`, connect at `connect`, which asks for it. `scope` is what the server asked for |

`scope` is there only with kind `scope`, and only when the server's
`WWW-Authenticate` challenge named one, as it put it, such as
`"read write"`.

`connect` is there only for an [`oauth()`](#oauth) server: the path of the
app's [connect route](#connecting) for this server, under `basePath`, with
the call's conversation as `conversation` when it had one, and with kind
`scope` and a `scope`, that as `scope`:
`/mcp/connect/github?conversation=c_123&scope=read+write`. It's for the
browser, as a surface's prop or a link the user follows, relative to the
app's origin. Don't give it to the model.

A tool that catches the error decides what to do with it: such as tell the
model the user must connect an account first, or show a surface that asks
them to, with `connect` as its link:

```ts
try {
  const { items } = await searchIssues.call({ q: query }, ctx);
  return ctx.render(issueList, { issues: items });
} catch (err) {
  if (isMcpError(err) && err.reason === "auth") {
    return ctx.render(connectCard, { server: "github", need: err.auth!.kind, href: err.auth!.connect });
  }
  throw err;
}
```

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
import { pgCredentialStore } from "@haikit/mcp/postgres";

const mcpAuth = createMcpAuth({
  userOf: (id) => auth.ownerOf(id),
  // for oauth(): where each user's tokens are kept, sealed, and the routes
  store: pgCredentialStore(pool),
  secret: process.env.MCP_SECRET!,
  redirectUri: "https://app.example.com/mcp/callback",
  requestUser: async (req) => (await auth.user(req))?.id ?? null,
});

// a key each user gave the app
const tracker = mcpServer({
  name: "tracker",
  transport: http("https://mcp.tracker.example/mcp"),
  auth: mcpAuth.bearer((userId) => keys.find(userId)),
});
// each user's own account, connected through the app's routes
const github = mcpServer({
  name: "github",
  transport: http("https://mcp.github.example/mcp"),
  auth: mcpAuth.oauth({ issuer: "https://github.example/login/oauth" }),
});
const listIssues = tracker.tool("list_issues", { args: z.object({}) });

// in a HaiKIT tool's run, as the conversation's owner:
await listIssues.call({}, ctx);
// in a job, as a user it names:
await listIssues.call({}, { userId });

// beside the app's other routes: connect, the callback, disconnect
const mcpRoutes = mcpAuth.handler();
```

The URLs above show the shape only.
[`examples/hello-mcp`](https://github.com/wfoxd/haikit/tree/main/examples/hello-mcp)
is a whole app built this way, offline: an `oauth()` server behind its own
authorization server, a `bearer()` one and one with the app's own key, with
a connect card made from `err.auth`, a wake notice from `onConnected`, and a
settings panel on the routes.

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
  store?: CredentialStore;
  secret?: string | string[];
  redirectUri?: string;
  requestUser?(req: IncomingMessage): string | null | Promise<string | null>;
  onConnected?(connected: McpConnected): void | Promise<void>;
  basePath?: string;
  clientName?: string;
}

interface McpAuth {
  bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
  oauth(options?: OAuthServerOptions): McpServerAuth;
  sdk(make: (userId: string) => AuthProvider | OAuthClientProvider | null | Promise<AuthProvider | OAuthClientProvider | null>): McpServerAuth;
  handler(): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  connections(userId: string): Promise<McpAccount[]>;
  disconnect(userId: string, server?: string): Promise<void>;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `userOf` | required | Who a conversation belongs to: the user a call in it runs as. With `@haikit/auth`, `(id) => auth.ownerOf(id)` (see [Sign-in and ownership: `ownerOf`](auth.md#ownerof)). `null`, or anything but a non-empty string, for no one. The connect route asks it too, before it keeps a link's conversation |
| `store` | none | Where each user's OAuth credentials, the app's registered clients and the connect flows on their way are kept, sealed: [`memoryCredentialStore()`](#memorycredentialstore), or [`pgCredentialStore(db)`](#haikitmcppostgres) |
| `secret` | none | Seals every value the store keeps (see [Sealing](#sealing)). A list, to rotate: the first seals, and every one opens. Each at least 32 bytes, as UTF-8 |
| `redirectUri` | none | Where an authorization server sends the browser back, registered with it as `new URL(redirectUri).href`. Its path is the [callback](#the-callback). https, except on a loopback host |
| `requestUser` | none | The user signed in, for a request to the routes. With `@haikit/auth`, `async (req) => (await auth.user(req))?.id ?? null`. Anything but a non-empty string is no one. For `handler()` |
| `onConnected` | none | Told when a user has connected an account, at the callback (see [`McpConnected`](#mcpconnected)) |
| `basePath` | `"/mcp"` | Where `handler()`'s routes are, and the connect links point |
| `clientName` | the redirect URI's host, such as `app.example.com` | The app's name, which an authorization server shows the user as they connect: the `client_name` registered |

`store`, `secret` and `redirectUri` go together: all three, for
[`oauth()`](#oauth), [`handler()`](#handler),
[`connections()`](#connections) and [`disconnect()`](#disconnect), or none.
`bearer()` and `sdk()` need none of them.

**Returns** a frozen `McpAuth`, which makes the `auth` of each server whose
calls are made as each user. Servers given an `auth` from one `McpAuth` must
have different names (see [`mcpServer`](#mcpserver)). A name keys its users'
credentials in the store: a server renamed has none for its users until
they connect again.

**Throws** a `TypeError`, in this order:

- `createMcpAuth: userOf must be a function, such as (id) =>
  auth.ownerOf(id)`.
- `createMcpAuth: requestUser must be a function`, and the same for
  `onConnected`, for one given that isn't.
- `createMcpAuth: basePath must be a path such as "/mcp", with no trailing
  slash (got <basePath as JSON>)`: one or more segments, each `/` and one or
  more of `A–Z a–z 0–9 - . _ ~ ! $ & ' ( ) * + , ; = : @ %`.
- `createMcpAuth: basePath can't have a "." or ".." segment (got <basePath
  as JSON>)`, for one a URL's path would read differently, such as
  `/api/../mcp` or `/api/%2e%2e/mcp`: a request's path is read as a URL,
  which takes such segments out, so no route would match.
- `createMcpAuth: store, secret and redirectUri go together: oauth() needs
  all three`, for one or two of them.
- `createMcpAuth: store must be a CredentialStore, such as
  memoryCredentialStore()`, for one missing any of its nine methods.
- `createMcpAuth: secret must be a string, or a list of them`, for an empty
  list, or one with anything but strings.
- `createMcpAuth: each secret must be at least 32 bytes`.
- `createMcpAuth: redirectUri must be a URL, such as
  https://app.example.com/mcp/callback`.
- `createMcpAuth: redirectUri must be https, except on localhost`: http only
  on `localhost`, a name ending in `.localhost`, `127.0.0.1` or `[::1]`.
- `createMcpAuth: redirectUri can't have a query or a fragment`.
- `createMcpAuth: redirectUri comes back to <path>, a route handler()
  answers already`, for a path that is, or is under,
  `<basePath>/connect`, `/disconnect`, `/connections` or `/client.json`.
- `createMcpAuth: clientName must be a non-empty string`.

### `bearer`

```ts
bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
```

Each user's token, which the app already has, such as a key the user gave
it. `token(userId)` gives it, or `null` when the user has none. It is sent as
`Authorization: Bearer <token>` on every request of that user's connection.

- **It's looked up** when the user's connection has none, before its
  first connection or after a lookup found none, and again on each 401.
  It's kept on the connection in between, and
  [`forget(userId)`](#forget) drops it with the connection. One lookup runs
  at a time for each user's connection: first calls made together, and 401s
  that come together, share it, and only a lookup sets the token, so one
  call's refusal never throws away a newer token another call's 401 found.
- **`null`, `""`, or anything but a non-empty string** means the user has
  none: the call rejects with reason `auth`, kind `connect`, and nothing is
  sent. The next call looks again.
- **If `token` throws or rejects,** the call rejects with reason
  `connection`, `<server>/<tool> could not be reached`, its `cause` what it
  threw. One that gives nothing within `timeoutMs` rejects the same way,
  its `cause` `Error: no token within <timeoutMs> ms`, and the next lookup
  starts afresh. `forget()` and `close()` stop a lookup on its way, and its
  timer, so one that never answers doesn't keep the process running.
- **On a 401,** the transport looks it up again with `token(userId)`, and
  sends the request once more with what it gives, so a key the app has
  replaced is picked up without a failed call. `null` from that lookup, or a
  401 again, rejects the call with reason `auth`, kind `reconnect`. After
  `null`, the user's next call looks again, and rejects with kind `connect`,
  sending nothing, while the app still has none. After a 401 again, the
  token is kept, and the next 401 looks again.
- **A request is never sent without the user's token.** One whose call
  began with a token that has gone since, as when another call's 401 found
  none, is stopped before it is sent, and the call rejects with reason
  `auth`, kind `reconnect`.
- **On a 403 with `error="insufficient_scope"`,** the call rejects with
  reason `auth`, kind `scope`, with the `scope` the server's challenge
  asked for.

**Returns** a frozen `McpServerAuth`, `{ kind: "bearer" }`, for one
`mcpServer`.

**Throws** `TypeError: bearer: token must be a function that takes a user id
and returns their token, or null`.

### `oauth`

```ts
oauth(options?: OAuthServerOptions): McpServerAuth;

interface OAuthServerOptions {
  issuer?: string;
  scopes?: string[];
  client?: { id: string; secret?: string };
}
```

Each user connects their own account, with the server's authorization
server, through the app's [routes](#the-routes), and the store keeps their
tokens, sealed. Needs `createMcpAuth`'s `store`, `secret` and
`redirectUri`.

| Option | Default | Meaning |
| --- | --- | --- |
| `issuer` | none: whichever the server names | The authorization server the server must use, as its metadata's `issuer`, one trailing slash apart at most. A server names its own in its protected resource metadata. With `issuer`, a server that names another is refused before the app registers a client there, or sends a user to it. Pin it for a third party's server |
| `scopes` | the server's `scopes_supported`, from its metadata | Asked for whenever a user connects. A connect link's `scope` is added to them. The SDK adds `offline_access`, so a refresh token is issued, where the authorization server lists it in its `scopes_supported` |
| `client` | none: one is registered for the app | A client the app registered with the authorization server: its `id`, and its `secret` for a confidential one, sent as the authorization server takes it, HTTP Basic before a form field. Needs `issuer`. Never replaced by one registered on the fly |

**The app's client.** With no `client`, one is registered on the first
connect to each authorization server, and kept in the store for every user:
by the URL of the app's [client metadata
document](#the-client-metadata-document), where the authorization server
says it takes one (`client_id_metadata_document_supported`) and the
redirect URI is https; else by dynamic client registration (RFC 7591), as a
public client with the same metadata as that document. A kept client
registered for another redirect URI, or another document, or one that
doesn't open, is registered again on the next connect.

Each connect flow keeps the client it started with, and each credential the
client its tokens were issued to: the code is exchanged, and the tokens
refreshed and revoked, as that client, whatever the store keeps for new
connects. So two first connects at once that each register a client each
come back as their own, and a client registered again for a new redirect
URI leaves those connected before with theirs. A configured `client`'s
secret isn't kept with them: it's read from the options each time.

**A call:**

- **Before every call,** the user's credential is read from the store,
  within `timeoutMs`, once for the calls that start together, since another
  of the app's processes may have refreshed it, or the user connected again
  or disconnected there. With none, the call rejects with reason `auth`,
  kind `connect`, with the connect link, and nothing is sent; the user's
  connection, if they have one, is closed, and a call in flight on it
  rejects as when [it drops](#the-connection). One that doesn't open counts
  as none, and is logged: `@haikit/mcp: <server>: the credential of user
  <userId> doesn't open: sealed with a secret that's gone, or for another
  row`. A store that throws or rejects, or doesn't answer within
  `timeoutMs`, rejects the call with reason `connection`, its `cause` what
  it threw, or `Error: no credential within <timeoutMs> ms`.
- **A credential that changed** since the last call is used from then on.
  One refreshed elsewhere, with the same `connectedAt`, is used on the same
  connection. One the user connected again, with a new `connectedAt`, as
  when they connected another account, closes the connection as above, and
  the call makes a new one with it. Nothing of one account's is sent on a
  connection made as another: if a 401's refresh finds the user connected
  again (steps 1, 4 and 5), the call rejects with reason `connection`, its
  `cause` `Error: the user connected again since this connection was
  made`, and the next call makes the connection again.
- **Every request** on the user's connection carries their access token, as
  `Authorization: Bearer`, and the token is bound to the server by the
  resource indicator it was issued for (RFC 8707). It's sent only to that
  server, and refreshed only at the authorization server that issued it.
- **On a 401,** the credential is refreshed, once for the user at a time,
  however many requests got a 401 together, such as a new connection's
  stream and its list of tools, and once for the user at a time across the
  app's processes sharing the store, by the store's lease (step 4). A 401
  waits for the refresh, steps 1 to 7, for at most `timeoutMs`, then the
  call rejects with reason `connection`, its `cause` `Error: no refresh
  within <timeoutMs> ms`. The refresh itself goes on until it settles, since
  it may have spent the refresh token already: a 401 meanwhile, on the
  user's connection or a new one, waits for it rather than sending another,
  and the tokens it gets are stored.
  1. The store is read again. A newer credential, as another process's
     refresh wrote, is used as it is, with nothing sent to the authorization
     server. With none, the call rejects with kind `reconnect`.
  2. A credential with no refresh token is deleted, and the call rejects
     with kind `reconnect`.
  3. The authorization server is found from the server's metadata, once for
     each server, and kept. It must be the one that issued the credential:
     if it isn't, it's found again, once, and if it still isn't, the call
     rejects with reason `protocol`, nothing is sent, and `@haikit/mcp:
     <server>: no refresh for user <userId>: <why>` is logged. The
     credential is kept.
  4. The store's refresh lease is taken ([`lease`](#credentialstore)), for
     2 × `timeoutMs`, so one process at a time spends the refresh token.
     While another process holds it, the store is read every 250 ms: the
     credential it writes is used as it is, with nothing sent, one it
     deletes rejects the call with kind `reconnect`, and once its lease
     lapses, as when that process is gone, this one takes it. After 4 ×
     `timeoutMs` of other processes' leases, the refresh fails, `Error:
     other processes held the refresh lease for <4 × timeoutMs> ms`, and
     the credential is kept.
  5. The refresh is sent, as the client the tokens were issued to (see
     [The app's client](#oauth)), with the resource indicator. If the
     authorization server refuses it, with `invalid_grant`, `invalid_client`
     or `unauthorized_client`, the store is read again, and a newer
     credential, as when another process spent the same refresh token after
     this one's lease lapsed, is used. Else the credential is deleted, if
     the store still holds the one the refresh began with, and the call
     rejects with kind `reconnect`.
  6. Anything else, such as no answer, a 503, or any other error, rejects
     the call with reason `connection`, keeps the credential, and gives the
     lease back, for the next 401 to try again.
  7. The new tokens are written over the credential the refresh began with,
     keeping its `connectedAt` and its client, and its scope unless the
     tokens name one, which ends the lease. The old refresh token may be
     spent, so a store that throws or rejects is tried twice more, 250 ms
     apart, under the lease, and a try that landed though its answer was
     lost counts as written, the third too if the store then holds it. If
     the third throws, and the store doesn't hold what it wrote, the call
     rejects with reason `connection`, its `cause` what the store threw, and
     the lease is kept until it lapses. If another write came first, or
     a delete, as by a [disconnect](#disconnect), the new tokens are no
     one's, and are revoked rather than left live: the refresh token if the
     authorization server rotated it, else only the access token, since the
     one refresh token may be what the store holds now. A revocation that
     fails is logged, `@haikit/mcp: <server>: the tokens refreshed for user
     <userId> weren't stored, and couldn't be revoked: <err>`. The store's
     credential is then used instead, or with none, the call rejects with
     kind `reconnect`. The transport then sends the request once more, with
     the new token: a 401 again rejects with kind `reconnect`, and keeps the
     credential.
- **No call starts a sign-in,** or registers a client: only the connect
  route does.
- **On a 403 with `error="insufficient_scope"`,** the call rejects with
  kind `scope`, and a connect link that asks for the `scope` the challenge
  named.
- **[`forget(userId)`](#forget) and [`close()`](#close)** stop a lookup of
  the credential on its way, but not a refresh: an authorization server that
  rotates refresh tokens has spent the old one, so the new tokens are stored
  when they come.

**Returns** a frozen `McpServerAuth`, `{ kind: "oauth" }`, for one
`mcpServer`.

**Throws** a `TypeError`, in this order:

- `oauth() needs createMcpAuth({ store, secret, redirectUri })`.
- `oauth: options must be an object`.
- `oauth: issuer must be the authorization server's issuer URL`, for one
  that doesn't parse.
- `oauth: issuer must be https, except on localhost`.
- `oauth: scopes must be a list of OAuth scopes, such as ["repo"], each
  without spaces`: each one or more characters of printable ASCII but `"`
  and `\`, as RFC 6749 has a scope.
- `oauth: client must be { id, secret? }, as registered with the
  authorization server`, for an `id` that isn't a non-empty string, or a
  `secret` that isn't a string.
- `oauth: a client needs the issuer it was registered with`.

### `sdk`

```ts
sdk(make: (userId: string) => AuthProvider | OAuthClientProvider | null | Promise<AuthProvider | OAuthClientProvider | null>): McpServerAuth;
```

One of the SDK's own providers, made for each user's connection:
`make(userId)` gives it, or `null` when the user has none. The transport is
given it as it is, and the app's provider does the rest, refreshing
included. Nothing is stored, and there's no connect route: an `auth` error
has no `connect`. `OAuthClientProvider` is the SDK's interface,
re-exported.

- **It's made** before each of the user's connections, within `timeoutMs`,
  and kept until the connection is closed.
- **`null`, or anything but an object,** means the user has none: the call
  rejects with reason `auth`, kind `connect`, and nothing is sent.
- **If `make` throws or rejects,** the call rejects with reason
  `connection`, its `cause` what it threw, or with nothing within
  `timeoutMs`, `Error: no provider within <timeoutMs> ms`.
- **On a 401,** the SDK calls the provider: an `AuthProvider`'s
  `onUnauthorized`, or for an `OAuthClientProvider`, the SDK's own refresh,
  and its `redirectToAuthorization` when that can't. A call that still has
  no token the server takes rejects with kind `reconnect`.

**Returns** a frozen `McpServerAuth`, `{ kind: "sdk" }`, for one
`mcpServer`.

**Throws** `TypeError: sdk: make must be a function that takes a user id and
returns their AuthProvider, or null`.

### `connections`

```ts
connections(userId: string): Promise<McpAccount[]>;

interface McpAccount {
  name: string;
  scope: string | null;
  connectedAt: number;
}
```

The servers the user has connected an account for: each open `oauth()`
server of this `McpAuth` the store has a credential of theirs for that
opens, in the order the store lists them. One for a server no longer
configured isn't listed.

| Field | Meaning |
| --- | --- |
| `name` | The server's `name` |
| `scope` | The scope granted, as the authorization server's token response named it, or else as asked for; `null` with neither |
| `connectedAt` | When the user connected, epoch ms. A refresh keeps it |

**Rejects:** `TypeError: connections() needs createMcpAuth({ store,
secret, redirectUri })`, `TypeError: connections() needs a userId`, for one
that isn't a non-empty string, and what the store throws.

### `disconnect`

```ts
disconnect(userId: string, server?: string): Promise<void>;
```

For the server named, or with none, for each server the store lists a
credential of the user's for:

1. **The tokens are revoked** (RFC 7009) where the authorization server's
   metadata has a `revocation_endpoint`: the refresh token if there is one,
   else the access token, within `timeoutMs`. The client the tokens were
   issued to authenticates, as the token requests do, as the metadata's
   `revocation_endpoint_auth_methods_supported` says, or else its
   `token_endpoint_auth_methods_supported`. A revocation that fails, or an
   endpoint that isn't https or on a loopback host, is logged, `@haikit/mcp:
   <server>: the tokens of user <userId> couldn't be revoked, and are
   deleted anyway: <err>`, and doesn't stop the rest. A credential that
   doesn't open isn't revoked.
2. **The credential is deleted.** A refresh on its way, in this process or
   another, then can't write what it got, and revokes it (see
   [`oauth`](#oauth), step 7).
3. **The user's connection is closed,** as by [`forget(userId)`](#forget).

A name that isn't an open `oauth()` server's, such as a server no longer
configured, only has its credential deleted.

**Rejects:** `TypeError: disconnect() needs createMcpAuth({ store, secret,
redirectUri })`, `TypeError: disconnect() needs a userId`, `TypeError:
disconnect(): server must be a server's name`, for a `server` that isn't a
non-empty string, and what the store throws.

### `McpServerAuth`

```ts
interface McpServerAuth {
  readonly kind: "bearer" | "oauth" | "sdk";
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
- **For `oauth()`, closed when a call finds the credential gone,** or the
  user connected again in another process. That call, once they have one,
  or the next, makes a new connection with it (see [`oauth`](#oauth)).

A user whose connection was closed for room, for idling or by `forget` gets
a new one on their next call, checked as a first one, with their credential
looked up again.

## The routes

### `handler`

```ts
handler(): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
```

The routes users connect and disconnect their accounts with, for the
`oauth()` servers of this `McpAuth`. Resolves `true` for a request it
answered, and `false` for any other, for the app to answer: mount it beside
the app's other routes.

```ts
const mcpRoutes = mcpAuth.handler();
createServer(async (req, res) => {
  if (await authRoutes(req, res)) return;
  if (await mcpRoutes(req, res)) return;
  if (await haiRoutes(req, res)) return;
  // the app's own
});
```

| Request | Answer |
| --- | --- |
| `GET <basePath>/connect/<server>` | 303 to the authorization server ([Connecting](#connecting)) |
| `GET <the redirect URI's path>` | The done page ([The callback](#the-callback)) |
| `POST <basePath>/disconnect/<server>` | 204 ([Disconnecting](#disconnecting)) |
| `GET <basePath>/connections` | `{ "servers": McpAccount[] }` ([The user's connections](#the-users-connections)) |
| `GET <basePath>/client.json` | The client metadata document, when the redirect URI is https ([The client metadata document](#the-client-metadata-document)) |

`<server>` is the server's `name`, URL-encoded as one path segment. Anything
else resolves `false`: another method or path, a path with more segments, or
one that doesn't decode.

Every route acts for the user `requestUser` gives, never for one a request
names. A route that throws is logged, `@haikit/mcp: a request failed:
<err>`, and answered, unless it had answered already: with the done page,
`failed`, for connect and the callback, and 500 `{ "error": <its message> }`
for the others.

**Throws** a `TypeError`: `handler() needs createMcpAuth({ store, secret,
redirectUri })`, or `handler() needs createMcpAuth's requestUser: its routes
act for the user signed in`.

### Connecting

`GET <basePath>/connect/<server>`, with `conversation` and `scope` in the
query as [`McpAuthNeed.connect`](#mcpauthneed) puts them. In order:

1. **Signed out:** the done page, `signed_out`.
2. **No such server:** a `<server>` that isn't an open `oauth()` server of
   this `McpAuth` is 404 `{ "error": "no server of that name connects with
   OAuth" }`.
3. **The conversation** is kept only if `userOf` says it's the user's, and
   it's at most 512 characters. Else it's dropped, and the connect goes on
   without it. A `userOf` that throws drops it too, logged: `@haikit/mcp:
   <server>: the owner of the conversation a connect link names couldn't be
   looked up, so it's dropped:`.
4. **The scope** must be an OAuth scope (RFC 6749: tokens of printable ASCII
   but `"` and `\`, one space apart) of at most 1,000 characters. Else the
   done page, `failed`, logged.
5. **The authorization server is found,** by the SDK's `auth()`, from the
   server's protected resource metadata, each request within `timeoutMs`.
   Before a client is looked up or registered, it is refused if `issuer`
   pins another, or if its authorization endpoint isn't https or on a
   loopback host. Then the app's client: the one configured, the one kept,
   or a new one (see [`oauth`](#oauth)).
6. **The flow is stored,** sealed, under a new `state` of 32 random bytes,
   base64url: the user, the server, the conversation, the PKCE verifier,
   the client, what discovery found, and the scope asked for. It lasts 10
   minutes.
7. **303** to the authorization endpoint, `cache-control: no-store`, with
   `response_type=code`, `client_id`, `code_challenge` and
   `code_challenge_method=S256` (PKCE), `redirect_uri`, `state`, `scope`
   (as [`oauth`](#oauth)'s `scopes` says, with the link's added),
   `prompt=consent` when that scope has `offline_access`, as the SDK asks
   for a refresh token, and `resource`, the server's resource indicator.

A failure in steps 5 to 7 is the done page, `failed`, and is logged:
`@haikit/mcp: <server>: connecting user <userId> couldn't start: <err>`.

A connect always starts a sign-in, whatever the user has: one already
connected replaces their credential when they come back.

### The callback

`GET <the redirect URI's path>`, where the authorization server sends the
browser back, with `code`, `state` and `iss`. In order:

1. **The flow `state` names is taken** from the store, so it's used up
   whatever comes next: a callback URL sent to someone else connects no one.
   None, one past its 10 minutes, or one that doesn't open: the done page,
   `expired`.
2. **Signed out:** `signed_out`. **Signed in as another user** than the one
   who started it: `refused`.
3. **`error=access_denied`:** `access_denied`. Any other `error`, no
   `code`, or a server no longer configured: `failed`, logged.
4. **The code is exchanged** at the authorization server, and as the
   client, the flow started with, with the PKCE verifier, the redirect URI
   and the resource indicator, within `timeoutMs`. Before it asks for a
   token, the SDK checks `iss` against that server's `issuer` (RFC 9207):
   one that differs, or none from an authorization server whose metadata
   says it sends one, is `failed`. A failure here is `failed`, and is
   logged: `@haikit/mcp: <server>: connecting user <userId> failed: <err>`.
5. **The credential is stored,** sealed, over whatever the user had for the
   server: the tokens, stamped with the authorization server's `issuer`, the
   client they were issued to, the scope granted, and when. If what the
   store holds changes under it three times running, the callback is
   `failed`. The user's connection to the server is closed, so their next
   call dials with the new credential.
6. **`onConnected` is called,** and awaited. What it throws is logged,
   `@haikit/mcp: <server>: onConnected threw, and user <userId> is connected
   all the same: <err>`.
7. **The done page,** connected.

#### `McpConnected`

```ts
interface McpConnected {
  userId: string;
  server: string;
  conversationId?: string;
}
```

What `onConnected` is told: the user, the server's `name`, and the
conversation the connect link named, only if it's the user's. Waking that
conversation, as with [`hai.notify`](notices.md#hainotify), is for the app to do.

### The done page

Connect, but for its 404, and the callback answer with this page, always
status 200, `text/html; charset=utf-8`, with:

- `content-security-policy: default-src 'none'; script-src
  'sha256-<its script's hash>'; frame-ancestors 'none'`: its own script
  runs, nothing else does, and no page can frame it.
- `cache-control: no-store` and `referrer-policy: no-referrer`.

Its script posts `{ type: "haikit:mcp", server, ok, error? }` to the window
that opened it, at the page's own origin, and closes. `server` is absent
when no flow was found. With no window that opened it, as when the app
navigated to the connect link rather than opening a popup, the page shows
one line, and a link back to `/`:

| `error` | The line |
| --- | --- |
| none, with `ok: true` | Connected. You can close this window. |
| `signed_out` | Not connected: sign in, then try again. |
| `access_denied` | Not connected: access wasn't allowed. |
| `expired` | Not connected: this link has expired. Try again. |
| `refused` | Not connected: you're signed in as someone else. |
| `failed` | Not connected: something went wrong. Try again. |

A page that opens the connect link in a popup hears how it went:

```ts
window.open(href, "connect", "popup");
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.type !== "haikit:mcp") return;
  // e.data.ok, e.data.server, e.data.error
});
```

### Disconnecting

`POST <basePath>/disconnect/<server>`. In order:

1. **From another site:** 403 `{ "error": "this request came from another
   site" }`, as `@haikit/auth`'s sign-out checks. A request is from this
   site when its `Origin` is the redirect URI's origin or names the
   request's `Host`, or with no `Origin`, when `Sec-Fetch-Site` is absent,
   `same-origin` or `none`. A browser sends `Origin` on every POST from a
   page; a client that isn't a browser sends neither, and passes.
2. **Signed out:** 401 `{ "error": "sign in to continue" }`.
3. **No such server:** 404 `{ "error": "no server of that name connects
   with OAuth" }`.
4. [`disconnect(user, server)`](#disconnect), then 204, `cache-control:
   no-store`.

### The user's connections

`GET <basePath>/connections`: 200 `{ "servers": McpAccount[] }`, from
[`connections(user)`](#connections), `cache-control: no-store`. Signed out:
401 `{ "error": "sign in to continue" }`.

### The client metadata document

`GET <basePath>/client.json`, only when the redirect URI is https: 200,
`cache-control: max-age=3600`, as in:

```json
{
  "client_id": "https://app.example.com/mcp/client.json",
  "client_name": "app.example.com",
  "redirect_uris": ["https://app.example.com/mcp/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Its URL, `<basePath>/client.json` on the redirect URI's origin, is the app's
`client_id` at an authorization server that takes one, so the app needs no
registration there. The handler must be mounted on that origin. With an http
redirect URI, the SDK can't use one, and the route resolves `false`.

## Credential stores

### `CredentialStore`

```ts
interface CredentialStore {
  get(userId: string, server: string): Promise<string | null>;
  put(userId: string, server: string, value: string, previous: string | null): Promise<boolean>;
  delete(userId: string, server?: string, previous?: string): Promise<void>;
  list(userId: string): Promise<string[]>;
  lease(userId: string, server: string, previous: string, holder: string, ms: number): Promise<boolean>;
  getClient(server: string, issuer: string): Promise<string | null>;
  putClient(server: string, issuer: string, value: string): Promise<void>;
  putFlow(state: string, value: string, expiresAt: number): Promise<void>;
  takeFlow(state: string): Promise<string | null>;
}
```

Where each user's credentials are kept, with their refresh leases, the
app's clients registered at each authorization server, and the connect
flows on their way. Every value is
an opaque string, [sealed](#sealing) before the store sees it. Two sealings
of the same thing never give the same string, so a value tells one write
from another.

| Method | Contract |
| --- | --- |
| `get` | A user's credential for a server, or `null` |
| `put` | Writes it only if the row still holds `previous` (`null`: no row yet), and resolves `true`; else `false`, changing nothing. The check and the write must be one atomic step: of two writes onto the same value at once, one lands |
| `delete` | Deletes the user's credential for `server`, or with no `server`, all of theirs. With `previous`, only if the row still holds it. Nothing there is fine |
| `list` | The names of the servers the user has a credential for |
| `lease` | Takes the refresh lease of the user's credential for `server` for `ms`, by the store's own clock, and resolves `true`, only if the row still holds `previous` and no lease is held but `holder`'s; else `false`, changing nothing. Its own `holder` may take it again, and gives it back with `ms` 0. A `put` or `delete` of the row ends its lease. A lease isn't a write of the credential. The check and the take must be one atomic step: of two takes at once by different holders, at most one is `true` |
| `getClient`, `putClient` | The app's client for a server at an authorization server's `issuer`, which every user's next connect starts with. `putClient` replaces one |
| `putFlow` | Keeps a flow under its `state` until it's taken, or `expiresAt` (epoch ms) passes |
| `takeFlow` | Removes a flow and gives it, once: of two takes at once, one gets it. `null` for none, or one past its `expiresAt` |

`createMcpAuth` checks only that the nine methods are functions. A store of
the app's own can run the contract tests in `packages/mcp/test/store.mjs`.

### `memoryCredentialStore`

```ts
function memoryCredentialStore(): CredentialStore;
```

Keeps everything in this process's memory: gone on a restart, and seen by no
other process. For one server, and for development. It keeps the latest
10,000 flows: putting one drops those past their time, and the oldest while
there are 10,000.

### `@haikit/mcp/postgres`

```ts
// from "@haikit/mcp/postgres"
function pgCredentialStore(db: Queryable): CredentialStore;
function migrate(db: Queryable): Promise<void>;
const schema: readonly string[];

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
```

Keeps everything in Postgres, shared by every server. Each method is one
statement. `put` onto no row is an `INSERT … ON CONFLICT DO NOTHING`, and
onto a value an `UPDATE … WHERE value = <previous>`, so of two servers'
writes at once, one lands, and either ends the row's lease. `lease` is an
`UPDATE … WHERE value = <previous>` that also checks the lease, by the
database's clock, so the app's servers agree on when it lapses however
their own clocks differ. `takeFlow` is a `DELETE … RETURNING`, so a flow
is taken once, and is past its time by the database's clock. `putFlow`
deletes the flows past their time in the same statement. `Queryable` is the
same shape as `@haikit/postgres`'s and `@haikit/auth/postgres`'s (see
[Stores](stores.md#queryable)), so one pool serves all three.

`migrate` runs each statement of `schema`, in order. Each is idempotent, so
it can run on every start. Pass `schema` to your own migration tool instead
if you have one.

```sql
CREATE TABLE IF NOT EXISTS haikit_mcp_credentials (
  user_id      text NOT NULL,
  server       text NOT NULL,
  value        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  lease_holder text,
  lease_until  timestamptz,
  PRIMARY KEY (user_id, server)
);
CREATE TABLE IF NOT EXISTS haikit_mcp_clients (
  server text NOT NULL,
  issuer text NOT NULL,
  value  text NOT NULL,
  PRIMARY KEY (server, issuer)
);
CREATE TABLE IF NOT EXISTS haikit_mcp_flows (
  state      text PRIMARY KEY,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL
);
```

`updated_at` is set on each write of a credential, and not by a lease.
`lease_holder` and `lease_until` are its refresh lease, cleared by each
write.

### Sealing

Every value the store keeps is sealed with AES-256-GCM, its key derived from
the secret by HKDF-SHA256 (no salt, info `"haikit/mcp credentials"`), with a
new 12-byte IV each time. A sealed value is `v1.` and the base64url of the
IV, the 16-byte tag and the ciphertext.

- **Bound to its row.** A value is sealed for where it's kept, as additional
  data: a user and a server, a server and an issuer, or a flow's `state`. A
  value copied to another row doesn't open there, so a database write can't
  give one user another's credential.
- **Rotation.** With `secret` a list, the first seals, and each one opens
  what it sealed. To rotate, put the new secret first. Drop the old once
  every credential has been written again, as each refresh and connect
  does, which Postgres's `updated_at` shows, and the flows on their way have
  had their 10 minutes. A credential the old secret still sealed then
  doesn't open, and the user connects again. A kept client it sealed is registered
  again on the next connect: each credential keeps its own client, so none
  is lost with it.
- **A value that doesn't open** counts as none. A credential that doesn't is
  logged (see [`oauth`](#oauth)), and the user's next call is `connect`.
- **A leaked table or backup** holds no token that can be used without the
  secret. Keep the secret where the app keeps its JWT secret, not in the
  database.

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
| everything else | The SDK's `StreamableHTTPClientTransportOptions`, such as `authProvider` for a bearer token from a function, or an OAuth client, and `requestInit` and `fetch`. For an `oauth()` server, its `fetch` also makes every request to the authorization server, from the routes and on a refresh |

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
  any conversation, over that user's own connection, and no request on it
  is sent without their token. It never falls back to the app's credentials,
  another user's, or none, and a `userId` that isn't the
  conversation's owner is refused (see
  [Who a call runs as](#who-a-call-runs-as)).
- **A user's token stays with the app.** `bearer`'s token is kept in memory
  on the user's connection, and sent only to that server. An OAuth
  credential is kept sealed in the store, and in memory on the user's
  connection: its access token is sent only to that server, bound to it by
  the resource indicator, and its refresh token only to the authorization
  server that issued it. None is in an error's message or on the done page,
  and the model never sees one.
- **The connect link is for the browser.** `err.auth.connect` is a path on
  the app, for a surface or a link the user follows: don't give it to the
  model.
- **Pin the issuer** of a third party's server, with `oauth({ issuer })`. A
  server names its own authorization server, and one compromised could send
  users to a fake sign-in page. A server that names another is refused
  before the app registers a client there or sends anyone to it, and a
  refresh only ever goes to the authorization server that issued the
  credential.
- **A connect flow** lasts 10 minutes, is taken once, belongs to the user who
  started it, and uses PKCE (S256), a `state` of 32 random bytes, and the
  `iss` check of RFC 9207. The redirect URI is the configured one: nothing
  in a request chooses it.
- **Sealed at rest, and bound to its row** (see [Sealing](#sealing)). Keep
  `secret` where the app keeps its JWT secret.
- **The routes act for the user signed in,** from `requestUser`, never for a
  user a request names. Disconnecting refuses a request from another site,
  and the done page runs only its own script, can't be framed, and isn't
  kept by a cache.
- **Waking a conversation.** `onConnected` is told a conversation only if
  it's the user's, so a connect link can't wake someone else's.
- **A confused deputy.** A prompt injection in one user's conversation acts
  with that user's access, and nobody else's.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| A call with no answer and no progress | 30,000 ms, by default | `timeoutMs` |
| A call in all, connecting included | 90,000 ms, by default | `maxTotalMs` |
| Making the transport, connecting, listing the tools, and with `auth` looking up a user's credential | `timeoutMs` each | `connect` |
| Longest `timeoutMs` and `maxTotalMs` | 2,147,483,647 ms | Node's longest timer |
| `textOf` | 8,000 characters, by default | `maxChars` |
| Pages of tools listed | 64 | the SDK's `listMaxPages` |
| One stdio message | 10 MB | the SDK's `maxBufferSize` |
| Connections, without `auth` | 1, shared by every call | |
| Connections, with `auth` | 1 per user; at most `maxConnections`, 100 by default, with no call in flight | `maxConnections` |
| A user's connection with no call is kept | 300,000 ms, by default | `idleMs` |
| Lookups of a user's credential at once, for each user's connection | 1, shared by first calls (for `oauth()`, by calls) and, for `bearer`, 401s that come together | [`bearer`](#bearer), [`oauth`](#oauth), [`sdk`](#sdk) |
| Refreshes of a user's OAuth credential at once, for each user's connection | 1, shared by 401s that come together | [`oauth`](#oauth) |
| Reads of a user's OAuth credential, for each user's connection | 1 before every call, shared by calls that start together | [`oauth`](#oauth) |
| A refresh, and each request to an authorization server | `timeoutMs` each | [`oauth`](#oauth) |
| A connect flow | 600,000 ms (10 min), and taken once | [Connecting](#connecting) |
| Flows `memoryCredentialStore` keeps | 10,000 | [`memoryCredentialStore`](#memorycredentialstore) |
| A connect link's `scope` | 1,000 characters | [Connecting](#connecting) |
| A connect link's `conversation`, to be kept | 512 characters | [Connecting](#connecting) |
| Writes of a new credential at the callback | 3 tries | [The callback](#the-callback) |
| Writes of a refreshed credential, while the store throws | 3 tries, 250 ms apart | [`oauth`](#oauth) |
| A `secret` | 32 bytes or more, each | [`createMcpAuth`](#createmcpauth) |
| The client metadata document, in a cache | 3,600 s | `cache-control: max-age=3600` |
| Times a call is sent | 1 | |

A call runs inside a turn, which holds the conversation's lease. The lease
lasts 120,000 ms by default (`leaseMs` in [Stores](stores.md)) and isn't
renewed while a tool runs, so a turn's model calls and tool calls together
must finish within it. `maxTotalMs` leaves 30 s of that for the rest.
