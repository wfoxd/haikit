# Configuration and limits

Every option HaiKIT takes, in one place, and every fixed limit and timing it
applies, with its value. Each row links to the page that explains it.

Checked against `@haikit/*` 0.20.0. Durations are in milliseconds.

- [Options](#options)
- [Fixed limits and timings](#fixed-limits-and-timings)
- [Names HaiKIT uses](#names-haikit-uses): channels, storage keys, framework
  text

## Options

### `createHai` (`@haikit/server`)

| Option | Default | Valid values | Page |
| --- | --- | --- | --- |
| `model` | required | a `ModelAdapter` | [Models](models.md) |
| `store` | required | a `StoreAdapter` | [Stores](stores.md) |
| `system` | required | a string | [The server](server.md#haiconfig) |
| `tools` | required | an array of tools. A later duplicate name wins, in the earlier one's place; `query_ui` is reserved | [Tools](tools.md#definetool) |
| `surfaces` | required | an array of surface implementations | [Surfaces](surfaces.md) |
| `scope` | `DEFAULT_SCOPE` | a string, or `false` (`""` counts as `false`) | [The server](server.md#scope) |
| `maxHops` | `8` | a positive whole number. Not validated: 0 or less means no model call, a fraction rounds up, `Infinity` means no limit, and a string is converted (see the page) | [The server](server.md#maxhops) |
| `init` | none | a tool whose name no other tool has, `query_ui` included | [The server](server.md#init) |
| `notices` | `[]` | notice implementations with unique names | [Notices](notices.md) |
| `maxWakes` | `{ count: 1, perMs: 60000 }` | `count` a safe integer ≥ 1, `perMs` finite and > 0. Both, or neither | [Notices](notices.md#maxwakes) |
| `updates` | off | `true` turns on `hai.update` | [Revisions](revisions.md#haiconfigupdates) |
| `signals` | `[]` | signals with unique names | [Signals and presence](signals.md) |
| `presence.graceMs` | `5000` | a whole number from 1 to 2147483647 | [Signals and presence](signals.md#haiconfigpresence) |
| `presence.heartbeatMs` | `10000` | a whole number from 1 to 2147483647 | [Signals and presence](signals.md#haiconfigpresence) |

### Surfaces, tools and capping (`@haikit/core`)

| Option | Default | Valid values | Page |
| --- | --- | --- | --- |
| `staleAfterMs` (on an implementation) | `"never"` | `"never"`, or a positive finite number | [Surfaces](surfaces.md#freshness) |
| `strict` (on a tool) | `true` | a boolean. Leave it out rather than passing `undefined`, which overrides the default | [Tools](tools.md#definetool) |
| `description`, `argsJsonSchema` (on a `query`) | none | a string; a JSON Schema. Without `argsJsonSchema`, the model sees `args: (undeclared — omit them)`, and `createHai` warns | [Surfaces](surfaces.md#query) |
| `mode` (`ctx.render`) | `"display"` | `"display"` or `"elicit"`. Anything else counts as `"elicit"` | [Tools](tools.md#render) |
| `message`, `done`, `total` (`ctx.progress`) | none | a string; a finite number ≥ 0; a finite number > 0. Others are dropped, not thrown on | [Tools](tools.md#progress) |
| `handle` (`hai.notify`) | none | a stored surface of the conversation | [Notices](notices.md#notifyoptions) |
| `replay` (`hai.streamOpened`) | `emit` | a function | [Signals and presence](signals.md#haistreamopened) |
| `kind` (on a notice) | `"passive"` | `"passive"` or `"wake"` | [Notices](notices.md#definenotice) |
| `maxRows` (`cap`) | `8` | a number. Not validated | [Tools](tools.md#cap-capoptions) |
| `maxChars` (`cap`) | `1800` | a number. Not validated | [Tools](tools.md#cap-capoptions) |

### `hai.update` (`@haikit/server`)

| Option | Default | Valid values | Page |
| --- | --- | --- | --- |
| `model` | none | a string | [Revisions](revisions.md#updateoptions) |
| `wake` | `false` | only `true` wakes | [Revisions](revisions.md#updateoptions) |
| `timeoutMs` | `30000` | a finite number ≥ 0 | [Revisions](revisions.md#updateoptions) |

### `nodeHandler` (`@haikit/server`)

| Parameter | Default | Page |
| --- | --- | --- |
| `basePath` | `"/hai"`, with no trailing `/` | [HTTP routes and the wire](http.md#nodehandler) |
| `options.maxBodyBytes` | `1048576` (1 MiB): a longer POST body is answered 413 | [HTTP routes and the wire](http.md#requests) |
| `options.gate` | none: a conversation id is all a request needs | [HTTP routes and the wire](http.md#gates) |

### Stores

| Option | Default | Valid values | Page |
| --- | --- | --- | --- |
| `memoryStore({ leaseMs })` | `120000` | positive and finite | [Stores](stores.md#memorystore) |
| `pgStore(db, { leaseMs })` | `120000` | positive and finite | [Stores](stores.md#pgstoreoptions) |
| `pgStore(db, { listen })` | none | a `Listener` on a connection of its own | [Stores](stores.md#listener) |
| `sweepOrphans(db, { olderThanMs })` | required | a number | [Stores](stores.md#sweeporphans) |

### `anthropic` (`@haikit/anthropic`)

| Option | Default | Page |
| --- | --- | --- |
| `model` | `"claude-haiku-5-5"` | [Models](models.md#anthropicoptions) |
| `maxTokens` | `16000` | [Models](models.md#anthropicoptions) |
| `effort` | `"medium"`: one of `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"` | [Models](models.md#anthropicoptions) |
| `apiKey` | the SDK's default, from `ANTHROPIC_API_KEY` | [Models](models.md#anthropicoptions) |

### `openai` (`@haikit/openai`)

| Option | Default | Page |
| --- | --- | --- |
| `model` | `"gpt-6-luna"` | [Models](models.md#openaioptions) |
| `maxTokens` | `16000` | [Models](models.md#openaioptions) |
| `effort` | `"medium"`: one of `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, or `null` to send no reasoning settings | [Models](models.md#openaioptions) |
| `apiKey` | the SDK's default, from `OPENAI_API_KEY` | [Models](models.md#openaioptions) |
| `baseURL` | the SDK's default, from `OPENAI_BASE_URL`, else `https://api.openai.com/v1` | [Models](models.md#openaioptions) |
| `promptCacheKey` | none: no `prompt_cache_key` is sent | [Models](models.md#openaioptions) |

### `createChat` (`@haikit/client`)

| Option | Default | Page |
| --- | --- | --- |
| `endpoint` | `"/hai"` | [The browser client](client.md#createchat) |
| `registry` | required | [The browser client](client.md#createchat) |
| `notices` | `{}` | [The browser client](client.md#createchat) |
| `signals` | `{}` | [The browser client](client.md#createchat) |
| `eventsFallbackMs` | `8000` | [The browser client](client.md#polling) |
| `pollHoldMs` | `15000` (the server clamps it to 0–15000) | [The browser client](client.md#polling) |
| `fetch` | the page's `fetch`, looked up at each request | [The browser client](client.md#createchat) |

### `mountChat` (`@haikit/client/app.js`)

| Option | Default | Page |
| --- | --- | --- |
| `root`, `registry` | required | [The default UI](ui.md#mountchatoptions) |
| `notices`, `signals` | `{}` | [The default UI](ui.md#mountchatoptions) |
| `endpoint` | `"/hai"` | [The default UI](ui.md#mountchatoptions) |
| `title` | `"HaiKIT"` | [The default UI](ui.md#mountchatoptions) |
| `subtitle` | `""` | [The default UI](ui.md#mountchatoptions) |
| `suggestions` | `[]` | [The default UI](ui.md#mountchatoptions) |
| `inspector` | `true` | [The default UI](ui.md#mountchatoptions) |
| `placeholder` | `"message…"`, replaced by fixed text while a question waits and once the conversation has expired | [The default UI](ui.md#mountchatoptions) |
| `emptyText` | `""` | [The default UI](ui.md#mountchatoptions) |
| `theme` | follows the system, or a `data-hai-theme` already on `<html>`. Only `"light"` or `"dark"` pins | [The default UI](ui.md#mountchatoptions) |
| `dock` | `true` | [The default UI](ui.md#the-dock) |
| `eventsFallbackMs`, `pollHoldMs`, `fetch` | as `createChat` | [The default UI](ui.md#mountchatoptions) |
| `signIn` | none: signed out, the status line says only why | [The default UI](ui.md#mountchatoptions) |

### `createAuth` (`@haikit/auth`)

| Option | Default | Page |
| --- | --- | --- |
| `store` | required | [Sign-in and ownership](auth.md#stores) |
| `jwt.secret` | none; at least 32 bytes each | [Sign-in and ownership](auth.md#createauth) |
| `jwt.jwks` | none; `secret`, `jwks` or both required | [Sign-in and ownership](auth.md#createauth) |
| `jwt.issuer`, `jwt.audience` | none: not checked | [Sign-in and ownership](auth.md#createauth) |
| `jwt.algorithms` | `["HS256"]` with a secret, plus `["RS256", "ES256", "EdDSA"]` with a JWKS | [Sign-in and ownership](auth.md#createauth) |
| `jwt.userClaim` | `"sub"` | [Sign-in and ownership](auth.md#createauth) |
| `jwt.ttlMs` | `604800000` (7 days), at least 1000 | [Sign-in and ownership](auth.md#tokens) |
| `jwt.clockToleranceMs` | `5000`, finite and at least 0 | [Sign-in and ownership](auth.md#tokens) |
| `cookie.name` | `"__Host-haikit_token"`, or `"haikit_token"` when not `secure` | [Sign-in and ownership](auth.md#createauth) |
| `cookie.secure` | `true` | [Sign-in and ownership](auth.md#createauth) |
| `origins` | `[]`: only the request's own host | [Sign-in and ownership](auth.md#the-gate) |
| `providers` | `[]`; needs `jwt.secret` | [Sign-in and ownership](auth.md#signing-in-with-a-provider) |
| `handler(basePath)` | `"/auth"` | [Sign-in and ownership](auth.md#routes) |

### `oidc` and `google` (`@haikit/auth/oidc`)

| Option | Default | Page |
| --- | --- | --- |
| `scopes` | `["openid", "email", "profile"]`; `openid` always | [Sign-in and ownership](auth.md#oidc) |
| `user` | `{name}:{sub}`, with `name` and a verified `email` as claims | [Sign-in and ownership](auth.md#oidc) |
| `tokenEndpointAuthMethod` | `"client_secret_basic"`, unless the provider lists only `"client_secret_post"` | [Sign-in and ownership](auth.md#oidc) |
| `maxAgeMs` | none: no limit on how long ago the user signed in at the provider | [Sign-in and ownership](auth.md#oidc) |
| `failureUrl` | `"/"` | [Sign-in and ownership](auth.md#when-it-fails) |
| `fetch` | the global `fetch` | [Sign-in and ownership](auth.md#oidc) |
| `google`'s `prompt` | `"select_account"`; `""` sends none | [Sign-in and ownership](auth.md#google) |
| `google`'s `hostedDomain` | none: any Google account | [Sign-in and ownership](auth.md#google) |

### `hai.css`

Every `--hai-*` custom property, colours and the layout tokens `--hai-radius`
(`0`), `--hai-column` (`780px`) and `--hai-inspector-width` (`400px`), is
an override point. See [The default UI: tokens](ui.md#tokens).

## Fixed limits and timings

None of these can be changed without changing HaiKIT's code.

### Turns and tools

| What | Value | Page |
| --- | --- | --- |
| Questions per model reply | 1 | [Tools](tools.md#render) |
| Tool calls run at once | 1: in order, one at a time | [Tools](tools.md#how-a-tool-call-runs) |
| Least time between two `progress` frames from one call | 100 | [Tools](tools.md#progress) |
| Turns in flight per conversation | 1, enforced by the lease | [Conversations](conversations.md#leases-and-fencing) |
| Token estimate (`modelTokens`, `uiTokens`, `~N tok`) | the JSON's length ÷ 4, rounded up | [Tools](tools.md#esttokens) |

### Revisions (`hai.update`)

| What | Value | Page |
| --- | --- | --- |
| Wait before retrying a busy conversation | 100, doubling each time | [Revisions](revisions.md#haiupdate) |
| Longest wait between retries | 2000 | [Revisions](revisions.md#haiupdate) |
| Writes in flight per surface, per `Hai` | 1, with the newest call waiting behind it | [Revisions](revisions.md#haiupdate) |
| Conversations whose surfaces' handles are remembered, for queueing | 10,000 most recently revised | [Revisions](revisions.md#haiupdate) |

### The events stream and polling (server)

| What | Value | Page |
| --- | --- | --- |
| Time between reads of new notices, without a `watch` wake-up | 2000 | [HTTP routes and the wire](http.md#the-events-stream) |
| Notices read from the store at a time | 100 | [HTTP routes and the wire](http.md#the-events-stream) |
| Time between `: ping` comments | 25,000 | [HTTP routes and the wire](http.md#the-events-stream) |
| A poll's longest hold, and its default | 15,000 | [HTTP routes and the wire](http.md#polling) |
| How long a poll waits after something new, before ending | 250 | [HTTP routes and the wire](http.md#polling) |
| Wake attempts a server makes per new wake notice | 1, unless it fails. None for a stream or poll with nothing new, except the server's first stream for a conversation, which looks once even with no notices | [HTTP routes and the wire](http.md#starting-wake-turns) |
| Wait before retrying a wake turn on a busy conversation | 250, doubling each time | [HTTP routes and the wire](http.md#the-events-stream) |
| Longest wait between those retries | 5000 | [HTTP routes and the wire](http.md#the-events-stream) |
| How long a server keeps listening for a conversation's wake turns after its last stream closes | at least 60,000 (longer while a turn runs, or an ended one is kept) | [HTTP routes and the wire](http.md#wake-turns-on-the-stream) |
| How long an ended wake turn is kept for polls | 60,000 | [HTTP routes and the wire](http.md#wake-turns-on-the-stream) |
| Ended wake turns kept per conversation | 5 | [HTTP routes and the wire](http.md#wake-turns-on-the-stream) |
| How often an open events stream asks its gate again | 60,000, and at its admission's `until` | [HTTP routes and the wire](http.md#gates) |

### Presence

| What | Value | Page |
| --- | --- | --- |
| Heartbeats missed before a server stops counting | 3 of the receiving server's, checked at its next recount | [Signals and presence](signals.md#presence) |
| Publishes in flight per `Hai` | 1, with the latest of each signal and of the count waiting | [Signals and presence](signals.md#across-servers) |
| Largest total count | `Number.MAX_SAFE_INTEGER` | [Signals and presence](signals.md#presence) |
| Longest `graceMs` or `heartbeatMs` | 2,147,483,647, the longest Node timer | [Signals and presence](signals.md#haiconfigpresence) |

### Postgres

| What | Value | Page |
| --- | --- | --- |
| Longest message `publish` takes | `MAX_PUBLISH_BYTES`: 52,500,000 UTF-8 bytes | [Stores](stores.md#max_publish_bytes) |
| Largest piece of a message per `NOTIFY` | 7000 base64 characters | [Stores](stores.md#turn_channel) |
| Most pieces in one message | 10,000 | [Stores](stores.md#turn_channel) |
| How long a part-received message waits for its other pieces | 30,000 | [Stores](stores.md#turn_channel) |
| Largest surface or notice `version` | 2,147,483,647: a whole number in 32-bit range | [Stores](stores.md#pgstore) |
| Payloads, notices and wake turns per conversation | 2,147,483,647 each: the next write fails once its counter reaches it | [Stores](stores.md#pgstore) |

### The browser client

| What | Value | Page |
| --- | --- | --- |
| Wait before retrying a request answered 409 | 150, once | [The browser client](client.md#requests) |
| Retrying after a wake turn's connection dropped | 250, doubling, at most 2000 apart, for up to 120,000 | [The browser client](client.md#requests) |
| Events stream reconnect wait | 1000, doubling, up to 30,000 | [The browser client](client.md#the-events-stream) |
| A connection that resets the reconnect wait | one that delivered an event, or stayed open 30,000, or, when polling, a poll that ended normally | [The browser client](client.md#the-events-stream) |
| Least time from one poll's start to the next | 250 | [The browser client](client.md#polling) |
| How long the browser remembers it must poll | 24 hours | [The browser client](client.md#polling) |
| Requests in flight per chat | 1: `start` and `send` queue, `interact` is dropped while any is open or queued | [The browser client](client.md#requests) |

### The default UI

| What | Value | Page |
| --- | --- | --- |
| Distance from the bottom that still counts as following, in the transcript and the drawer | 40 px | [The default UI](ui.md#rendertranscript) |
| Screen width at which the drawer opens beside the chat | `min-width: 900px` | [The default UI](ui.md#the-model-context-debug-drawer) |
| Tallest the message box grows, and a tool row's input and result | 200 px | [The default UI](ui.md#mountchat) |
| Width below which the subtitle and button labels are hidden | 900 px | [The default UI](ui.md#mountchat) |
| Width below which a docked surface opens as a sheet over the chat, and the shelf's count is hidden | 900 px | [The default UI](ui.md#the-dock) |
| Docked surfaces open at once | 1 | [The default UI](ui.md#the-dock) |
| Widest the dock's window grows | 560 px | [The default UI](ui.md#how-it-looks) |
| Width below which the model's name is hidden | 600 px | [The default UI](ui.md#mountchat) |

### Sign-in (`@haikit/auth`)

| What | Value | Page |
| --- | --- | --- |
| How long a server keeps a user's revocation time before reading it again | 30,000 | [Sign-in and ownership](auth.md#revoke) |
| Revocation granularity | 1 s: a sign-in in the second `revoke` ran in still counts | [Sign-in and ownership](auth.md#revoke) |
| Owners, and revocation times, kept in memory per server | the 10,000 most recent of each | [Sign-in and ownership](auth.md#ownerof) |
| When `GET /auth/me` issues a cookie token again | past half its life, not before | [Sign-in and ownership](auth.md#tokens) |
| How often a page must ask `GET /auth/me` to stay signed in | at least once every half of `ttlMs`: 3.5 days by default | [Sign-in and ownership](auth.md#tokens) |
| Longest an open events stream outlives a revocation | 60,000 on the server that revoked; about 90,000 on another | [Sign-in and ownership](auth.md#revoke) |
| JWKS refetched once older than; for an unknown key id, at most every; fetch timeout | 600,000; 30,000; 5000 (`jose`'s defaults) | [Sign-in and ownership](auth.md#createauth) |
| How long a sign-in through a provider may take, and its flow cookie's `Max-Age` | 600,000 | [Sign-in and ownership](auth.md#the-flow-cookie) |
| Longest `return_to` kept | 2,048 characters, percent-encoded | [Sign-in and ownership](auth.md#signing-in-there-and-back) |
| Largest flow cookie, name and value; past it, `return_to` is `/` | 4,096 bytes | [Sign-in and ownership](auth.md#signing-in-there-and-back) |
| `oidc`: reading the provider's settings, and exchanging the code, each give up after | 10,000 | [Sign-in and ownership](auth.md#oidc) |
| `oidc`: the provider's settings are kept | for the process's life, once read; a failed read is tried again | [Sign-in and ownership](auth.md#oidc) |

### Limits that don't exist

- **Request bodies** have no size limit, and their content type isn't
  checked (see [HTTP routes and the wire](http.md#requests)).
- **`memoryStore`'s `publish`** has no message size limit.
- **Conversations** aren't limited in number: any request can create one
  (see [HTTP routes and the wire](http.md#security-and-proxies)).
- **Nothing removes** old conversations, or `memoryStore`'s orphaned
  payloads (see [Stores](stores.md#cleaning-up)).

## Names HaiKIT uses

### Channels

| Name | Used for | Page |
| --- | --- | --- |
| `haikit:signals` | The `publish`/`subscribe` key for signals and presence | [Signals and presence](signals.md#across-servers) |
| `haikit_notices` | `pgStore`'s `NOTIFY` channel for new notices (`NOTICE_CHANNEL`) | [Stores](stores.md#notice_channel) |
| `haikit_turns` | `pgStore`'s `NOTIFY` channel for everything published (`TURN_CHANNEL`) | [Stores](stores.md#turn_channel) |

### Reserved tool name

`query_ui` is HaiKIT's own tool. A tool of yours with that name is replaced
by it (see [Tools](tools.md#the-built-in-query_ui-tool)).

### Routes and parameters

`POST {basePath}/chat`, `/start` and `/interact`, and `GET {basePath}/events`
with the parameters `conversationId`, `after`, `poll`, `wait`, `turn` and
`signals`, and the `Last-Event-ID` header. A stream opens with the comment
`: open`, and stays open with `: ping`. See
[HTTP routes and the wire](http.md).

### Browser storage

| Key | Holds | Page |
| --- | --- | --- |
| `hai:events-poll` (`localStorage`) | When this origin last had to poll, in epoch ms | [The browser client](client.md#polling) |
| `hai:debug-drawer` (`localStorage`) | `"open"` or `"closed"` | [The default UI](ui.md#the-model-context-debug-drawer) |

### DOM attributes

| Attribute | On | Page |
| --- | --- | --- |
| `data-hai-theme` | `<html>`, pinning the colour scheme | [The default UI](ui.md#themes) |
| `inert`, `data-expired` | a surface's element, once the conversation has expired | [The browser client](client.md#freshness-in-the-browser) |
| `data-handle`, `data-component` | a surface's element in the default transcript | [The default UI](ui.md#rendertranscript) |
| `data-notice` | a notice's element in the default transcript | [The default UI](ui.md#rendertranscript) |
| `data-pending` | a message's element in the default transcript, while its request is out and the server's copy hasn't arrived | [The default UI](ui.md#rendertranscript) |
| `data-status` | the default UI's status line: the conversation's status, or `unauthorized` while the server turns the chat away | [The default UI](ui.md#mountchat) |

### Tables

`haikit_conversations`, `haikit_payloads` and `haikit_notices`, and the
index `haikit_payloads_created_at`: see
[Stores: the schema](stores.md#the-schema). `@haikit/auth/postgres`'s
`haikit_auth_owners` and `haikit_auth_revocations`, and the index
`haikit_auth_owners_user`: see [Sign-in and ownership](auth.md#migrate-schema).

### Cookies

| Name | Holds | Page |
| --- | --- | --- |
| `__Host-haikit_token`, or `haikit_token` when not `secure` | The token `@haikit/auth`'s `signIn` issues | [Sign-in and ownership](auth.md#signin) |
| `__Host-haikit_sign_in`, or `haikit_sign_in` when not `secure` | A sign-in through a provider, while it's on its way: 10 minutes at most | [Sign-in and ownership](auth.md#the-flow-cookie) |

### Framework text in the history

| Text | When | Page |
| --- | --- | --- |
| `[conversation started]` | The first user message, when init runs before the user has typed | [The server](server.md#init) |
| `[UI interaction] <label>` | An `inform` click | [Surfaces](surfaces.md#how-a-click-is-handled) |
| `[App notification: <name>] <text>` | A notice taken in | [Notices](notices.md#what-the-model-hears) |
| `[UI update] <model, then a space, when given><old handle> was replaced by <new handle>; its earlier digest is out of date. Now: <digest>` | An update notice taken in | [Revisions](revisions.md#how-the-model-hears-of-it) |
| `[The user has not said anything. The notifications above arrived on their own.]` | A wake turn's user message | [Notices](notices.md#haiwake) |
| `<digest>` + newline + `<label>` | A question's tool result, answered by a click | [Surfaces](surfaces.md#how-a-click-is-handled) |
| `<digest>` + newline + `User did not select; they said: "<text>"` | A question's tool result, closed out by a typed message. Quotes in `<text>` aren't escaped | [Conversations](conversations.md#what-haikit-writes-into-the-history) |

### Framework text in tool results

| Text | When | Page |
| --- | --- | --- |
| `Unknown tool: <name>` | The model called a tool that doesn't exist | [Tools](tools.md#how-a-tool-call-runs) |
| `<name> already ran at the start of this conversation; its result is above.` | The model called the init tool | [The server](server.md#init) |
| `Invalid input for <name>: <message>` | The input failed the tool's schema | [Tools](tools.md#how-a-tool-call-runs) |
| `<name> failed: <message>` | The tool threw (a value that isn't an `Error` as text) | [Tools](tools.md#how-a-tool-call-runs) |
| `<name> returned no result.` | The tool's return had no string `model` | [Tools](tools.md#how-a-tool-call-runs) |
| `<name> failed: an error that can't be shown as text` | The tool threw a value that can't be made into text, such as an object with no prototype | [Tools](tools.md#how-a-tool-call-runs) |
| `<name> failed: surface <surface>: digest must return a string (got <type>)` | A surface's digest returned something other than a string | [Surfaces](surfaces.md#digest) |
| `Not run: your reply ended with stop_reason "<reason>" before this call was complete. Make it again if it's still needed.` | A call in a reply that stopped for another reason, such as `max_tokens` | [The server](server.md#how-a-turn-runs) |
| `Not shown: <handle> is already waiting for the user. Ask this again after it is answered.` | A second question in one reply | [Tools](tools.md#render) |
| `Not shown: the tool had already finished.`, `Not revised: the tool had already finished.` | A render or update after the tool returned | [Tools](tools.md#toolctx) |
| `No such handle: <handle>`, `Unsupported query "<query>". Available: <names, or none>.`, `Invalid args for "<query>": <message>` | `query_ui` couldn't answer | [Surfaces](surfaces.md#query-handlers) |
| `(<handle> has since been revised: it is <latest> now.)` | Added to a `query_ui` answer about a revised surface | [Surfaces](surfaces.md#query-handlers) |
| `0 of <total> match.`, `<n> of <total> match. <k> shown[, <m> omitted]:` | A capped query answer's first line | [Tools](tools.md#cap-capoptions) |

### Framework text the model sees outside the history

- The scope, after `system` and a blank line (see
  [The server](server.md#scope)).
- The init tool's note, after its description and a blank line (see
  [The server](server.md#init)).
- `query_ui`'s description and input schema (see
  [Tools](tools.md#the-built-in-query_ui-tool)).

### Id formats

| What | `memoryStore` | `pgStore` |
| --- | --- | --- |
| Conversation id | `conv_<n>_<16 hex digits>` | `conv_<32 hex digits>` |
| Handle | `ui_01`, `ui_02`, … across the store | `ui_01`, `ui_02`, … per conversation |
| Init call id | `toolu_init_<16 hex digits>` | the same |
| Block id | `b_<32 hex digits, random per Hai>_<n>`, counting up in each `Hai` | the same |
| Notice `seq`, the SSE id | 1, 2, … per conversation | the same |
| Wake turn number (`status.wake`) | 1, 2, … per conversation | the same |

The client adds block ids of its own: `ui:<handle>`, `n:<seq>`, and
`e<n>` and `x<n>`, where `n` is the number of blocks before it (see
[The browser client](client.md#block)).

### Messages the browser shows

The server's and the client's out-of-date messages, `initialisation failed:
<message>`, the 400 answer `the request body must be a JSON object`, the 413
answer `the request body is too large`, the 404 answer `unknown conversation`, the
client's fallbacks (`another turn is already in flight`,
`request failed (<status>)`), and the error cards (`unknown component:
<name>`, `unknown notice: <name>`): see
[Surfaces: freshness](surfaces.md#freshness), [The server](server.md#init), [HTTP routes and the wire](http.md#requests)
and [The browser client](client.md). `@haikit/auth`'s gate answers
`sign in to continue` and `your sign-in has expired or is invalid` (401),
`the request body must be sent as application/json` (415) and
`this request came from another site` (403): see
[Sign-in and ownership](auth.md#the-gate).
