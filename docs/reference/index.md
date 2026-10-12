# HaiKIT reference manual

The exact behaviour of every public function, type and configuration option in
HaiKIT, package by package. The [tutorials](../tutorial.md) teach by building an
app, the [design spec](../spec.md) explains why HaiKIT is shaped the way it is,
and the [default UI guide](../default-ui.md) walks through the chat screen. This
manual is where you look something up: what a function takes, what it returns,
what it refuses, and every default and limit that applies.

**Covers:** `@haikit/*` 0.20.0.

**Status:** in preparation. The pages below are planned, and each one is marked
as written once it has been checked against the source.

## Packages

| Package | What it is | Runs in |
| --- | --- | --- |
| `@haikit/core` | The contract: surfaces, notices, signals, tools, the wire format, and the model and store interfaces | server and browser (types) |
| `@haikit/server` | The runtime (`Hai`), the HTTP routes and the in-memory store | Node |
| `@haikit/postgres` | A Postgres store for production and for running several servers | Node |
| `@haikit/anthropic` | The model adapter for Claude | Node |
| `@haikit/client` | The browser runtime, the default chat UI and its stylesheet | browser, no build step |
| `@haikit/react` | Write surfaces and notices as React components | browser |

## Contents

| Page | Covers | Status |
| --- | --- | --- |
| [Concepts](concepts.md) | Short, exact definitions of the terms used throughout: dual channel, digest, payload, surface, handle, mode, parked turn, action, query, notice, revision, signal, presence, lease, freshness | written |
| [Surfaces](surfaces.md) | Declaring a surface and implementing it on the server: props, actions, queries, digests, freshness | written |
| [Tools](tools.md) | Declaring tools, what a tool can do through its context, the built-in `query_ui` tool, and capping long results | planned |
| [Notices](notices.md) | Telling a conversation something later: passive and wake notices, wake turns and their limits | planned |
| [Revisions](revisions.md) | Revising a surface in place, from inside a turn (`ctx.update`) and from outside one (`hai.update`) | planned |
| [Signals and presence](signals.md) | Broadcasts to every open browser, and counting who is watching | planned |
| [Conversations](conversations.md) | The stored conversation: its fields, statuses and lifecycle, leases, and the errors stores raise | planned |
| [The server](server.md) | `createHai`, the `Hai` class and every `HaiConfig` option | planned |
| [HTTP routes and the wire](http.md) | `nodeHandler`, each route's requests, responses and errors, the events stream and its polling mode, and every wire event | planned |
| [Models](models.md) | The model adapter interface, and `@haikit/anthropic` | planned |
| [Stores](stores.md) | The store interface every store implements, `memoryStore`, and `@haikit/postgres`: schema, migration, cross-server channels, cleanup | planned |
| [The browser client](client.md) | `createChat`, the `Chat` object and its state, and the registries for surfaces, notices and signals | planned |
| [The default UI](ui.md) | `mountChat`, the transcript and inspector renderers, and the `hai.css` tokens | planned |
| [React](react.md) | `reactSurface` and `reactNotice` | planned |
| [Configuration and limits](limits.md) | Every option in every package in one place, and every fixed limit and timing HaiKIT applies, with its value | planned |

## How each entry is written

Every function, method, type and option gets one entry, in this order:

1. **Signature**, copied from the source or the package's `.d.ts`, not
   paraphrased.
2. **Parameters**: one row each, with its type, its default if it has one,
   and what it does. An option you can leave out says what happens when you do.
3. **Returns**: the value, and when a promise settles.
4. **Refuses or throws**: every error, rejected value and HTTP status the
   entry can produce, and the condition for each.
5. **Behaviour**: the rules the types can't express, one per item. For
   example, what reaches the model and what reaches the browser, when
   something is stored, and what happens on a retry, a reconnect or a second
   server.
6. **Limits**: each fixed number that applies, with its value and unit.
7. **Example**: a minimal one, only where usage isn't obvious from the
   signature.
8. **Source**: the package and file the entry was checked against.

Conventions:

- Durations are milliseconds, sizes are characters unless stated, and a
  default is written as its value (`120_000`), with the meaning beside it
  (2 minutes).
- `?` marks an optional field or parameter, as in TypeScript.
- Each entry names the package to import from. A type a package uses but
  doesn't export, such as `memoryStore`'s options, is documented where it's
  used and marked *not exported*.

## Keeping it exact

- Every statement comes from the code. A default or limit is copied from the
  source, never from another document. Where a README and the code disagree,
  the code wins and the README gets fixed.
- A page records the version it was checked against. A release that changes
  a public signature, default or limit updates the page in the same pull
  request.
- Internals stay out: unexported classes and helpers, and files reachable only
  through `@haikit/client`'s `./*` export (such as `icons.js`). An internal is
  documented only where its effect can be seen from outside: a limit, a
  timing, a channel name, a `localStorage` key or a wire event.
- The symbol index below lists every name each package exports. A name that
  has no page, or a page entry for a name that's no longer exported, is a gap
  to fix.

## Symbol index

Every export of every package, with the page that documents it.

### `@haikit/core`

| Symbol | Kind | Page |
| --- | --- | --- |
| `ActionCtx` | interface | [Surfaces](surfaces.md) |
| `ActionKind` | type | [Surfaces](surfaces.md) |
| `ActionMap` | type | [Surfaces](surfaces.md) |
| `ActionSpec` | interface | [Surfaces](surfaces.md) |
| `AnyNoticeImpl` | type | [Notices](notices.md) |
| `AnySurfaceImpl` | type | [Surfaces](surfaces.md) |
| `Block` | type | [HTTP routes and the wire](http.md) |
| `Cap` | type | [Tools](tools.md) |
| `CapOptions` | interface | [Tools](tools.md) |
| `Capped` | interface | [Tools](tools.md) |
| `Conversation` | interface | [Conversations](conversations.md) |
| `ConversationBusy` | class | [Conversations](conversations.md) |
| `ConversationStatus` | type | [Conversations](conversations.md) |
| `defineNotice` | function | [Notices](notices.md) |
| `defineSignal` | function | [Signals and presence](signals.md) |
| `defineSurface` | function | [Surfaces](surfaces.md) |
| `defineTool` | function | [Tools](tools.md) |
| `DigestCtx` | interface | [Surfaces](surfaces.md) |
| `ElicitOptions` | type | [Surfaces](surfaces.md) |
| `Emit` | type | [HTTP routes and the wire](http.md) |
| `estTokens` | function | [Tools](tools.md) |
| `HasResolve` | type | [Surfaces](surfaces.md) |
| `Infer` | type | [Surfaces](surfaces.md) |
| `inform` | function | [Surfaces](surfaces.md) |
| `isConversationBusy` | function | [Conversations](conversations.md) |
| `isStaleLease` | function | [Conversations](conversations.md) |
| `JsonSchema` | type | [Tools](tools.md) |
| `makeCap` | function | [Tools](tools.md) |
| `Message` | interface | [Conversations](conversations.md) |
| `ModelAdapter` | interface | [Models](models.md) |
| `ModelRequest` | interface | [Models](models.md) |
| `ModelResponse` | interface | [Models](models.md) |
| `Notice` | interface | [Notices](notices.md) |
| `NoticeImpl` | interface | [Notices](notices.md) |
| `NoticeImplDef` | interface | [Notices](notices.md) |
| `NoticeKind` | type | [Notices](notices.md) |
| `NoticeRecord` | interface | [Notices](notices.md) |
| `Notify` | type | [Notices](notices.md) |
| `NotifyOptions` | interface | [Notices](notices.md) |
| `PayloadRecord` | interface | [Conversations](conversations.md) |
| `Pending` | interface | [Conversations](conversations.md) |
| `Progress` | interface | [Tools](tools.md) |
| `query` | function | [Surfaces](surfaces.md) |
| `QueryCtx` | interface | [Surfaces](surfaces.md) |
| `QueryMap` | type | [Surfaces](surfaces.md) |
| `QuerySpec` | interface | [Surfaces](surfaces.md) |
| `resolve` | function | [Surfaces](surfaces.md) |
| `Schema` | interface | [Surfaces](surfaces.md) |
| `SendSignal` | type | [Signals and presence](signals.md) |
| `Signal` | interface | [Signals and presence](signals.md) |
| `StaleLease` | class | [Conversations](conversations.md) |
| `StoreAdapter` | interface | [Stores](stores.md) |
| `Surface` | interface | [Surfaces](surfaces.md) |
| `SurfaceImpl` | interface | [Surfaces](surfaces.md) |
| `SurfaceImplDef` | interface | [Surfaces](surfaces.md) |
| `Tool` | interface | [Tools](tools.md) |
| `ToolCtx` | interface | [Tools](tools.md) |
| `ToolReturn` | interface | [Tools](tools.md) |
| `Update` | type | [Revisions](revisions.md) |
| `UpdateOptions` | interface | [Revisions](revisions.md) |
| `WireEvent` | type | [HTTP routes and the wire](http.md) |

### `@haikit/server`

| Symbol | Kind | Page |
| --- | --- | --- |
| `createHai` | function | [The server](server.md) |
| `DEFAULT_SCOPE` | constant | [The server](server.md) |
| `Hai` | class | [The server](server.md) |
| `HaiConfig` | interface | [The server](server.md) |
| `memoryStore` | function | [Stores](stores.md) |
| `nodeHandler` | function | [HTTP routes and the wire](http.md) |
| `WakeOutcome` | type | [Notices](notices.md) |

`Hai`'s public members are each documented on the page for what they do:
`notify` and `wake` in [Notices](notices.md), `update` in
[Revisions](revisions.md), `signal`, `onPresence` and `streamOpened` in
[Signals and presence](signals.md), and the rest (`config`, `system`,
`sendsNotices`, `streamsEvents`, `wakes`, `send`, `start`, `interact`) in
[The server](server.md).

### `@haikit/postgres`

| Symbol | Kind | Page |
| --- | --- | --- |
| `Listener` | interface | [Stores](stores.md) |
| `MAX_PUBLISH_BYTES` | constant | [Stores](stores.md) |
| `migrate` | function | [Stores](stores.md) |
| `NOTICE_CHANNEL` | constant | [Stores](stores.md) |
| `pgStore` | function | [Stores](stores.md) |
| `PgStoreOptions` | interface | [Stores](stores.md) |
| `Queryable` | interface | [Stores](stores.md) |
| `schema` | constant | [Stores](stores.md) |
| `sweepOrphans` | function | [Stores](stores.md) |
| `SweepOptions` | interface | [Stores](stores.md) |
| `TURN_CHANNEL` | constant | [Stores](stores.md) |

### `@haikit/anthropic`

| Symbol | Kind | Page |
| --- | --- | --- |
| `anthropic` | function | [Models](models.md) |
| `AnthropicOptions` | interface | [Models](models.md) |

### `@haikit/client`

From `@haikit/client`:

| Symbol | Kind | Page |
| --- | --- | --- |
| `Block` | type | [The browser client](client.md) |
| `Chat` | interface | [The browser client](client.md) |
| `ChatState` | interface | [The browser client](client.md) |
| `ComponentDef` | interface | [The browser client](client.md) |
| `ConversationStatus` | type | [The browser client](client.md) |
| `createChat` | function | [The browser client](client.md) |
| `MountCtx` | interface | [The browser client](client.md) |
| `NoticeDef` | interface | [The browser client](client.md) |
| `NoticeInstance` | interface | [The browser client](client.md) |
| `NoticeMountCtx` | interface | [The browser client](client.md) |
| `NoticeRecord` | interface | [The browser client](client.md) |
| `NoticeRegistry` | type | [The browser client](client.md) |
| `Progress` | interface | [The browser client](client.md) |
| `Registry` | type | [The browser client](client.md) |
| `SignalHandler` | type | [The browser client](client.md) |
| `SignalRegistry` | type | [The browser client](client.md) |
| `SurfaceInstance` | interface | [The browser client](client.md) |
| `SurfaceMode` | type | [The browser client](client.md) |
| `SurfaceRecord` | interface | [The browser client](client.md) |
| `SurfaceState` | type | [The browser client](client.md) |
| `WireEvent` | type | [The browser client](client.md) |

From `@haikit/client/app.js`, `@haikit/client/transcript.js` and
`@haikit/client/hai.css`:

| Symbol | Kind | Page |
| --- | --- | --- |
| `mountChat` | function (`app.js`) | [The default UI](ui.md) |
| `MountChatOptions` | interface (`app.js`) | [The default UI](ui.md) |
| `renderInspector` | function (`app.js`) | [The default UI](ui.md) |
| `renderTranscript` | function (`transcript.js`) | [The default UI](ui.md) |
| `closeTranscript` | function (`transcript.js`) | [The default UI](ui.md) |
| `h` | function (`transcript.js`) | [The default UI](ui.md) |
| `--hai-*` custom properties | CSS (`hai.css`) | [The default UI](ui.md) |

### `@haikit/react`

| Symbol | Kind | Page |
| --- | --- | --- |
| `NoticeProps` | interface | [React](react.md) |
| `reactNotice` | function | [React](react.md) |
| `reactSurface` | function | [React](react.md) |
| `SurfaceProps` | interface | [React](react.md) |
