# @haikit/mcp

## 0.35.1

### Patch Changes

- 4cd6dc6: A connection over HTTP now recovers when the server ends its session or can't be reached, the way a `stdio` connection recovers when its child exits. The SDK's HTTP transport closes only on `close()`, so before this, such a connection was kept, and every later call on it failed with reason `protocol`: for good without `auth`, and with `auth` until the user's connection was closed for idling, by `forget()`, or for `oauth()` by a reconnect. Now a request that gets a 404 on a connection with a session id (the spec's word that the session has ended), or a request to the server's URL from `http()`'s transport whose `fetch` rejects, drops the connection: that call rejects with reason `connection` and isn't sent again, a call in flight on the connection rejects with `connection` too, and the next call or `connect()` makes a new connection, whose tools are compared with the last list. Every other HTTP status, a 404 with no session, a 400 and a 5xx among them, keeps the connection and its reason, as before.
  - @haikit/core@0.35.1

## 0.35.0

### Minor Changes

- 449d22a: The connect card's and the notice's contracts, for asking a user to connect an `oauth()` server's account and for telling the conversation they have. `connectCard` is a surface named `connect_card`, version 1, with no actions, whose props are `ConnectCardProps`, `{ server, label, need, href }`: `href` must be a path on the app, so `//evil.example` and `/\evil.example` are refused. `connectCardFor(err, label?)` makes those props from an `auth` error with `err.auth.connect`, or gives `null` for any other error. `accountConnected` is a wake notice named `account_connected`, version 1, with `{ server }`, for `onConnected` to send with `hai.notify`. The app implements each with its own words for the model, and the browser imports them as types only, since the package's entry loads Node's modules.

### Patch Changes

- @haikit/core@0.35.0

## 0.34.0

### Minor Changes

- 0901077: Each user's own OAuth account. `createMcpAuth` takes `store`, `secret` and `redirectUri`, and then `mcpAuth.oauth({ issuer?, scopes?, client? })` makes a server's calls with the tokens each user connected: through `mcpAuth.handler()`'s routes, a connect route that sends the browser to the server's authorization server with PKCE and the resource indicator, and a callback that checks `iss`, stores the tokens and shows a done page that tells the window that opened it. `requestUser` says who is signed in for the routes, `onConnected` hears each connect, with the conversation the link was for if it's the user's, and `basePath` (`"/mcp"`) and `clientName` are optional. With no `client`, one is registered for the app, by its client metadata document where the authorization server takes one, else by dynamic registration. A 401 refreshes the user's credential, once for all the requests that got one, as the client its tokens were issued to: across app processes sharing the store, one at a time takes the store's refresh lease (`CredentialStore.lease`) and spends the refresh token, and the others use what it stores; each call reads the store first, so it uses a refresh from another process, and makes the connection again after the user connects again there. A refusal deletes the credential and rejects with `reconnect`, and an outage keeps it and rejects with `connection`. Credentials are kept in a `CredentialStore`, `memoryCredentialStore()`, or `pgCredentialStore(db)` from the new `@haikit/mcp/postgres` subpath, with `migrate` and `schema`, sealed with AES-256-GCM and bound to their row; `secret` can be a list, to rotate. `mcpAuth.connections(userId)` lists what a user connected (`McpAccount`), and `mcpAuth.disconnect(userId, server?)` revokes, deletes and closes. `mcpAuth.sdk(make)` takes one of the SDK's own providers for each user, and `OAuthClientProvider` is re-exported. An `auth` error from an `oauth()` server has `err.auth.connect` (`McpAuthNeed.connect`), the app's connect link for it, asking for the scope a 403 named. `McpErrorReason` is unchanged; `McpServerAuth.kind` has two more members, `"oauth"` and `"sdk"`, so a `switch` over it that must be exhaustive needs cases for them.

### Patch Changes

- @haikit/core@0.34.0

## 0.33.0

### Minor Changes

- a36454a: Calls as each user. `mcpServer({ auth })` takes `createMcpAuth({ userOf }).bearer(token)`: each call then runs as the conversation's owner, from `userOf(ctx.conversationId)`, or as `ctx.userId` for a call outside any conversation, with that user's own token, over a connection of their own. A call with no one to run as rejects with the new reason `user`, and nothing is sent; it never falls back to the app's credentials. A user with no token, a token the server refuses, and a 403 asking for more scope reject with the new reason `auth`, and `err.auth` (`McpAuthNeed`) says which: `connect`, `reconnect` or `scope`. On a 401 the token is looked up once more, so a key the app replaced is picked up; a user's lookups that come together share one, and one that gives nothing within `timeoutMs` fails with `connection`. `close()` stops a call still waiting for `userOf` or a token, with `closed`; `forget(userId)` stops one on the user's connection, including one waiting for their token. Each user's connection checks the tools they see, and `McpToolChange.user` says whose tools changed. The connections are pooled: `maxConnections` (100) and `idleMs` (300,000 ms), and `forget(userId)` closes one. `connect(userId)` connects as a user. `http()` now returns `(authProvider?) => Transport`, and `AuthProvider` is re-exported. `McpErrorReason` has two more members, so a `switch` over it that must be exhaustive needs cases for `user` and `auth`.

### Patch Changes

- @haikit/core@0.33.0

## 0.32.0

### Minor Changes

- 6f9cfe6: New, optional package: `@haikit/mcp`, for calling MCP servers' tools from inside an app's own tools. The model never sees an MCP tool: `mcpServer({ name, transport })` connects to a server over `http(url)` or `stdio({ command })`, and `server.tool(name, { args, result })` declares one of its tools, typed by the app's own schemas, which a HaiKIT tool calls with `call(args, ctx)` and then decides what the model hears and what the browser shows. An `McpTool` isn't a `Tool`, so `createHai({ tools })` can't be given one, and `npm run typetest` asserts it. `connect()` checks at startup that every declared tool is on the server. A call parses its args before sending them, and its result with the `result` schema; forwards the server's progress to `ctx.progress`, which keeps it alive; times out after 30 s without word and 90 s in all, connecting included, within the turn lease; reconnects once when the connection has dropped; and throws `McpToolError` when the tool reports an error, or `McpError` with a `reason` otherwise. The messages name only the server and the tool, with the server's words on `text`, so an error a tool lets through reaches the model as `<name> failed: <server>/<tool> …` without them. `onChange` hears that a declared tool was removed or changed its schema. `textOf(result)` makes text of a result, marking any cut.

### Patch Changes

- @haikit/core@0.32.0
