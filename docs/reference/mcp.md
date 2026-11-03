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
`McpError`, `McpErrorReason`, `McpToolError`, `isMcpError`,
`isMcpToolError`, `http`, `HttpOptions`, `stdio`, `textOf`, `TextOptions`,
and, re-exported from `@modelcontextprotocol/client`, the types
`ContentBlock` and `Transport`.

Checked against `@haikit/*` 0.31.0 and `@modelcontextprotocol/client` 2.4.0.
Source: `packages/mcp/src/index.ts`, `packages/mcp/src/errors.ts`,
`packages/mcp/src/text.ts` and `packages/mcp/src/transports.ts`.

- [The rule](#the-rule): the model never sees an MCP tool
- [`mcpServer`](#mcpserver): `McpServerOptions`
- [`McpConnection`](#mcpconnection): `tool`, `McpToolDef`, `connect`,
  `close`
- [A call](#a-call): `McpTool`, `call`, `McpCallCtx`, `McpResult`
- [Errors](#errors): `McpError`, `McpErrorReason`, `McpToolError`,
  `isMcpError`, `isMcpToolError`, and what the model hears of one
- [The connection](#the-connection): connecting, reconnecting, what this
  client tells a server
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
  transport: () => Transport | Promise<Transport>;
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
| `transport` | required | Makes a connection. Called by the first `connect()` or call, and again for each reconnect, so it must make a new `Transport` each time. [`http(url)`](#http) and [`stdio({ command })`](#stdio) return one |
| `timeoutMs` | `30_000` (30 s) | How long the server may go without answering a call or reporting progress on it. It also bounds making the transport, connecting, and listing the server's tools |
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

## `McpConnection`

```ts
interface McpConnection {
  readonly name: string;
  tool<A, R>(name: string, def: McpToolDef<A, R> & { result: Schema<R> }): McpTool<A, R>;
  tool<A>(name: string, def: McpToolDef<A, unknown> & { result?: undefined }): McpTool<A, McpResult>;
  connect(): Promise<void>;
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
  checked against the server's latest list of tools at once, and the
  `Error` `connect` would throw is thrown here: `<server>: the server has no
  tool named "<name>"`, or `<server>: tool "<name>" can only run as an MCP
  task, which @haikit/mcp does not support`.

### `connect`

```ts
connect(): Promise<void>;
```

Connects, and checks every declared tool. Call it at startup, after
declaring the tools, so a mistake stops the app there. Without it, the first
call connects, and fails with the same error.

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
| Listing the tools fails | `McpError`, its reason as for a call (see [Errors](#errors)), named for the server alone, such as `<server> did not answer in time` |
| A declared tool fails the check | `Error`: `<server>: ` then each problem, in the order the tools were declared, joined by `; `. A problem is `the server has no tool named "<name>"`, or `tool "<name>" can only run as an MCP task, which @haikit/mcp does not support` |
| `close()` was called, before or while connecting | `McpError`, reason `closed`: `<server>: the connection was closed` |

After any rejection the connection is closed and nothing is kept, so the
next `connect()` or call starts again from step 1. Only the first connection
to succeed is checked; see [The connection](#the-connection) for later ones.

### `close`

```ts
close(): Promise<void>;
```

Closes the connection, and resolves once it is closed. A `stdio` server is
sent end-of-input, then `SIGTERM` after 2 s, then `SIGKILL` after 2 s more
(the SDK's `StdioClientTransport.close`).

A connection still being made is stopped where it is: a `transport()` still
pending is given up on, and what it makes later is closed; a client still
connecting, or listing the tools, is closed. The `connect()` or call waiting
on it rejects with reason `closed`, and so does a call in flight. It is final: every later call rejects with
`McpError`, reason `closed`, `<server>/<tool>: the connection was closed`,
without connecting, and `connect()` with `<server>: the connection was
closed`.

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
2. **It connects,** if it isn't connected, as [`connect`](#connect) does. A
   failure rejects the call with the same reason, named for the call, as in
   `<server>/<tool> could not be reached`, and the same `cause`, `text` and
   `code`. The `Error` of a declared tool failing the check rejects the call
   as it is. Connecting counts against `maxTotalMs`: a call still waiting for
   the connection when it runs out rejects with reason `timeout`, and the
   connection goes on being made for the calls after it.
3. **The tool is called** (`tools/call`) with the parsed args.
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
4. **The result is decided** (see below).

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
SDK's words on `text`.

### `McpCallCtx`

```ts
interface McpCallCtx {
  readonly conversationId?: string;
  progress?(progress: Progress): void;
}
```

What a call is made for. A HaiKIT tool's [`ToolCtx`](tools.md#toolctx) or an
action handler's [`ActionCtx`](surfaces.md) can be passed as it is, and so
can nothing at all, as from a background job.

| Field | Meaning |
| --- | --- |
| `conversationId` | Not read yet. It is in the type so a later version can choose a connection per user without calls changing |
| `progress` | Hears the server's progress notifications, as described in step 3 above |

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
}

type McpErrorReason = "args" | "result" | "timeout" | "connection" | "protocol" | "closed";
```

A call that got no result, or one its schema refused.

| Field | Meaning |
| --- | --- |
| `server` | The server's `name` |
| `tool` | The tool called. `undefined` when `connect()` failed |
| `reason` | Why; see below |
| `text` | What the server, or the SDK, said about it, when it said anything: a JSON-RPC error's message, or the SDK's own |
| `code` | A JSON-RPC error's code, such as `-32602` |
| `cause` | The error it came from, when there was one: what a schema threw, or the SDK's error |

| `reason` | When | Message, for a call |
| --- | --- | --- |
| `args` | The `args` schema refused the args, or they aren't an object. Nothing was sent | `<server>/<tool> was not called: its args do not match the schema`, or `… its args must be an object` |
| `result` | The `result` schema refused the result, there was nothing to parse, or the SDK refused it against the server's output schema | `<server>/<tool> returned a result that does not match the schema` |
| `timeout` | No answer within `timeoutMs`, or not done within `maxTotalMs`, connecting included | `<server>/<tool> did not answer in time` |
| `connection` | The server couldn't be reached, or the connection dropped before the answer | `<server>/<tool> could not be reached` |
| `protocol` | The server refused the call, as for a tool it doesn't have (`code` `-32602`). Also any other SDK error, such as an HTTP 401 or 403, or a server asking this client for input | `<server>/<tool> was refused by the server` |
| `closed` | `close()` was called, before or during the call | `<server>/<tool>: the connection was closed` |

From `connect()`, the messages name the server alone: `<server> could not
be reached`, `<server> did not answer in time`, `<server> was refused by the
server`, and `<server>: the connection was closed`.

How an SDK error is read, in order: after `close()`, `closed`. A JSON-RPC
error (`ProtocolError`) is `protocol`, with its `code` and its message as
`text`, unless the message is about an output schema, which is the SDK's
check above, and `result`. Of the SDK's own errors (`SdkError`): a timeout
is `timeout`; not connected, connection closed, a failed send, or an HTTP
stream that wouldn't open is `connection`; an invalid result is `result`;
any other is `protocol`, with its message as `text`. Anything else is
`connection` if the connection had dropped, and `protocol` if not.

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

## Changes to the server's tools

```ts
interface McpToolChange {
  server: string;
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

Nothing else changes: the model's tools are the app's, and calls go on as
before. A call to a removed tool rejects with reason `protocol`; one whose
args no longer suit the server gets `McpToolError` from it.

**The default `onChange`** writes one `console.warn`: `@haikit/mcp:
<server>: ` then, joined by `; `, `tool "<name>" was removed` for each
removed tool, and `tool "<name>" changed its schema` for each changed one.

An `onChange` that throws has its error written with `console.error`.

## Transports

`Transport` is the SDK's interface, re-exported. Any function that makes a
new one each time can be `transport`, such as one returning the SDK's
`InMemoryTransport`, in a test.

### `http`

```ts
function http(url: string | URL, options?: HttpOptions): () => Transport;

interface HttpOptions extends StreamableHTTPClientTransportOptions {
  headers?: Record<string, string>;
}
```

A server at `url`, over Streamable HTTP. Each call of what it returns makes
a new `StreamableHTTPClientTransport`.

| Option | Meaning |
| --- | --- |
| `headers` | Sent on every request. Each is set over one of the same name in `requestInit.headers` |
| everything else | The SDK's `StreamableHTTPClientTransportOptions`, such as `authProvider` for a bearer token from a function, or an OAuth client, and `requestInit` and `fetch` |

The SDK sets some headers itself, over any of these: `Authorization`, when
an `authProvider` gives a token, and the protocol's own.

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
- **One identity per connection.** Every call on a connection is made with
  the same credentials, whoever the conversation belongs to.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| A call with no answer and no progress | 30,000 ms, by default | `timeoutMs` |
| A call in all, connecting included | 90,000 ms, by default | `maxTotalMs` |
| Making the transport, connecting, and listing the tools | `timeoutMs` each | `connect` |
| Longest `timeoutMs` and `maxTotalMs` | 2,147,483,647 ms | Node's longest timer |
| `textOf` | 8,000 characters, by default | `maxChars` |
| Pages of tools listed | 64 | the SDK's `listMaxPages` |
| One stdio message | 10 MB | the SDK's `maxBufferSize` |
| Connections in flight | 1, shared by every call | |
| Times a call is sent | 1 | |

A call runs inside a turn, which holds the conversation's lease. The lease
lasts 120,000 ms by default (`leaseMs` in [Stores](stores.md)) and isn't
renewed while a tool runs, so a turn's model calls and tool calls together
must finish within it. `maxTotalMs` leaves 30 s of that for the rest.
