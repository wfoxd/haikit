# HTTP routes and the wire

`nodeHandler` serves HaiKIT over Node's `http` module: three POST routes that
run turns, and a GET route that streams what happens after a request. Every
route answers with server-sent events, each frame one JSON *wire event*. This
page covers the routes' requests, responses and errors, the events stream and
its polling mode, and every wire event.

Exported by `@haikit/server`: `nodeHandler`. By `@haikit/core`: `WireEvent`,
`Emit`, `Block`.

Checked against `@haikit/*` 0.20.0. Source: `packages/server/src/routes.ts`,
`packages/server/src/runtime.ts` and `packages/core/src/index.ts`.

- [`nodeHandler`](#nodehandler)
- [The POST routes](#the-post-routes): `/chat`, `/start`, `/interact`
- [The events stream](#the-events-stream): `GET /events`
- [Polling](#polling)
- [Wake turns on the stream](#wake-turns-on-the-stream)
- [Wire events](#wire-events): `WireEvent`, `Block`, `Emit`
- [Security and proxies](#security-and-proxies)

## `nodeHandler`

```ts
function nodeHandler(
  hai: Hai,
  basePath = "/hai",
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
```

Returns a request handler for Node's `http` server. It resolves to `true` when
it handled the request, and `false` when the request isn't one of its routes,
so the app can serve it instead.

| Method and path | Served when | Purpose |
| --- | --- | --- |
| `POST {basePath}/chat` | always | Send a typed message |
| `POST {basePath}/start` | always | Open a conversation and run the init tool |
| `POST {basePath}/interact` | always | Send a click on a surface |
| `GET {basePath}/events` | `hai.streamsEvents` is `true` | Stream notices, revisions, signals and wake turns |

**Matching.** A request whose path doesn't start with `basePath` resolves to
`false`. The rest of the path must be exactly one of the routes above, with
the method shown, or it resolves to `false` too. So `basePath` must not end in
`/`. `GET {basePath}/events` resolves to `false` when the app has no notices,
no `updates` and no signals.

```ts
import { createServer } from "node:http";
import { nodeHandler } from "@haikit/server";

const handle = nodeHandler(hai, "/hai");
createServer(async (req, res) => {
  if (await handle(req, res)) return;
  // your own routes, static files, 404 …
}).listen(5180);
```

**The returned promise never rejects.** A request that fails in a way no
route answers itself is answered, ended and logged with `console.error`:

- before the response has started, such as a store error loading the
  conversation (other than `ConversationBusy`), or the events stream's first
  read of notices: **HTTP 500** with `{ "error": "<message>" }`;
- after it has started, such as a store error from a POST route's closing
  save (other than `StaleLease`): an `error` event, then the response ends.
  The conversation's lease stays held until it expires;
- on an events stream, a store error from a later read ends the stream, and
  the browser reconnects. On a poll, it's logged, and the poll ends when its
  hold runs out.

## The POST routes

### Requests

Each POST body is read whole and parsed as JSON. An empty body is `{}`. A
body that isn't a JSON object (invalid JSON, `null`, an array, a string), or
that fails while it's read, is answered **HTTP 400** with
`{ "error": "the request body must be a JSON object" }`. Nothing limits the
body's size or checks its content type: put that in front of the handler.

| Route | Body | Fields used |
| --- | --- | --- |
| `/chat` | `{ conversationId?, message }` | `message`, as `String(message ?? "")` |
| `/start` | `{ conversationId? }` | none beyond the id |
| `/interact` | `{ conversationId, handle, action, value }` | `handle`, `action`, `value`, and nothing else |

`conversationId` names the conversation. Left out, or naming one that doesn't
exist, it starts a new conversation (see
[Conversations](conversations.md#leases-and-fencing)). `/interact` takes no
tool name, handler or target: what an action means is decided on the server,
from the surface's contract.

### Responses

1. **`/start` without an init tool** answers at once with an empty event
   stream (status 200, the headers below, no frames) and creates no
   conversation.
2. **The conversation is loaded,** which takes its lease. If another request
   holds it, the answer is **HTTP 409** with a JSON body,
   `{ "error": "conversation <id> is busy — another turn is in flight" }`,
   and no event stream.
3. **The event stream opens:** status 200, with these headers:

   | Header | Value |
   | --- | --- |
   | `content-type` | `text/event-stream` |
   | `cache-control` | `no-cache, no-transform` |
   | `x-accel-buffering` | `no` |
   | `connection` | `keep-alive` |

4. **`/chat` and `/start` send `hello`** first:
   `{ type: "hello", conversationId, model, events? }`. `model` is the model
   adapter's `id`. `events: true` tells the browser to open the events
   stream. `/interact` sends no `hello`.
5. **The request runs:** `hai.send`, `hai.start` or `hai.interact` (see
   [The server](server.md#send-start-interact)), sending its wire events as
   it goes. An error it throws is sent as `{ type: "error", message }`.
6. **The lease is released and the conversation saved.** If the request
   already hit `StaleLease`, the save is skipped. A save error is sent as an
   `error` event; one other than `StaleLease` is also logged, and leaves the
   lease held until it expires (see above).
7. **The response ends.**

Every frame on a POST stream is `data: <JSON>` followed by a blank line, with
no `id:` line. Refusals other than the 409 arrive as events on a 200 stream:
`error` for a refused click or a failed turn, and `expired` for an expired
conversation.

**Typical sequences:**

- A typed message: `hello`, `block_start` (the `user` block), `status:
  streaming`, then for each hop `block_start` (`assistant`) and `text_delta`s,
  and for each tool call `block_start` (`tool`), any `progress`, `ui_open`
  and `ui_props`, then `block_update`. Finally `status: idle` (or `awaiting`)
  and `context`.
- The first message with an init tool: after the `user` block, `status:
  streaming`, the init call's `tool` block, its surfaces, and its
  `block_update`, then the turn as above.
- A `resolve` click: `ui_state` (frozen, with `selection`), `block_start`
  (the `interaction` block), then the turn from `status: streaming`.
- A typed message while a question waits: `hello`, `ui_state` (frozen, with
  no `selection`), then the `user` block and the turn.
- An init that parks on a question: after its `tool` block and surfaces,
  `block_update` with status `awaiting`, `status: awaiting` and `context`.
  The model doesn't run.
- An `inform` click: the `interaction` block, then the turn. No `ui_state`.
- An expired conversation: on `/chat`, `hello` then `expired`; on
  `/interact`, `expired`.
- `/start` on a conversation that has already begun, expired or not: `hello`
  only.
- A refused click: `error`.

A hop whose reply is only tool calls opens no `assistant` block: it opens on
the first piece of text.

**The turn runs to the end even if the browser leaves.** Nothing stops a
turn when the response's connection closes: the model and tools run, and the
result is saved, with nobody to send it to.

## The events stream

`GET {basePath}/events?conversationId=<id>` streams one conversation's
notices, revisions from `hai.update`, signals and wake turns. It accepts
nothing from the browser beyond which conversation, where to resume, and the
polling parameters below.

Reading notices takes no lease and writes nothing. But when `hai.wakes` is
`true`, each wake attempt (see [Starting wake turns](#starting-wake-turns)
below) takes the conversation's lease and saves it, even when no turn
starts. Attempts happen on every stream open, every poll, and every wake
notice read. A POST that arrives during one is answered 409, which the
client retries once.

### Query parameters and headers

| Parameter | Meaning |
| --- | --- |
| `conversationId` | The conversation. Missing counts as `""` |
| `after` | Send notices after this `seq`. Used when there's no `Last-Event-ID` |
| `Last-Event-ID` (header) | Send notices after this `seq`. Takes precedence over `after`. Browsers send it on reconnect |
| `poll` | `1` or `now` for a poll (see [Polling](#polling)). Anything else is a stream |
| `wait` | A poll's hold, in milliseconds |
| `turn` | The number of the last wake turn the browser saw end. Polls only. Missing counts as 0. One that isn't a safe integer replays no ended turns |
| `signals` | A fingerprint of the signal values the browser has. Polls only |

A resume point that isn't a positive safe integer counts as 0, which sends
every notice. A missing `conversationId` gets the 404 below.

### Responses

- **An unknown conversation** gets **HTTP 404** with
  `{ "error": "unknown conversation" }`.
- **Otherwise,** once this server is listening for other servers' wake turns
  (see [Wake turns on the stream](#wake-turns-on-the-stream)), status 200
  with the same headers as the POST routes, sent at once, with the comment
  `: open` as the first bytes. A browser that receives nothing at all knows
  something on the way is holding the stream back, and polls instead.

Then, until the browser leaves:

- **Notices,** from the store, in `seq` order. Every one after the resume
  point is sent first, 100 at a time, then each as it lands. Each is a
  `notice` event with its `seq` as the SSE id:

  ```
  id: 7
  data: {"type":"notice","seq":7,"name":"hold_confirmed","version":1,"payload":{…}}
  ```

- **Revisions** from `hai.update`, sent in place of their update notices as
  two frames, `ui_open` and then `ui_props`. Only the second carries the id
  (see [Revisions](revisions.md#how-the-browser-gets-it)). A revision whose
  payload is gone is sent as a frame with only an `id:` line and no `data:`,
  so the browser's resume point moves past it.
- **Signals:** each signal's latest value just after the stream opens, then
  each new one. No id. See [Signals and presence](signals.md).
- **Wake turns:** see [Wake turns on the stream](#wake-turns-on-the-stream).
- **`: ping`** every 25,000 ms, a comment that keeps proxies from dropping a
  quiet stream. It's skipped while the socket is backed up.

**When notices are read.** Every 2,000 ms, and sooner whenever the store's
`watch` says a notice may have landed. `watch` alone isn't relied on: a
wake-up can be lost, and a store's listening connection can drop, so the
timed reads go on regardless. An app that sends no notices (only signals)
reads nothing after the first check, and the stream stays open for signals
until the browser leaves, even if the conversation is deleted.

**Backpressure.** Notice and revision frames wait for the socket to drain,
so a slow reader can't make the server buffer every notice for it. Signals
that pile up meanwhile are kept to the latest of each name. A wake turn's
frames, and the replays below, are written regardless.

**The stream ends** when the browser leaves, when the conversation is
deleted from the store while the stream is open (a reconnect is then refused
with 404), or when a store read fails.

**Presence.** The stream counts toward presence while it's open (see
[Signals and presence](signals.md#presence)).

### Starting wake turns

When `hai.wakes` is `true`, the stream calls `hai.wake` once the whole
backlog of notices is sent, for a wake notice that arrived while nobody
watched, and again whenever it reads a wake notice. Each stream runs one
attempt at a time: a wake notice that lands meanwhile asks for another once
it's done. Several streams on one conversation make their own attempts, and
contend for the lease. While `hai.wake` answers `"busy"`, the stream tries
again after 250 ms, then twice as long each time, up to 5,000 ms, until it
closes. If `hai.wake` rejects, the stream gets an `error` event. See
[Notices: wake turns](notices.md#wake-turns).

## Polling

Some HTTPS-inspecting proxies (Netskope, Zscaler) hold a response back until
it ends, which a stream never does. For browsers behind one, the same route
answers a *poll*: what's waiting, and then the response ends. The client
switches to polling by itself (see [The browser client](client.md)).

A poll is a request with `poll=1` or `poll=now`. It sends what a stream would,
in the same frames, then ends at the first of:

- **something new, plus 250 ms.** Once anything new has gone out, the poll
  waits 250 ms for what comes with it, then ends, even if more of the
  backlog is still to send: the next poll resumes from the last id. New
  means a notice, a revision, a live frame of a wake turn, a wake turn that
  ended unseen, a new signal, the latest signal values when they differ from
  the browser's, or an `error` from a failed wake attempt. What a poll is
  replayed of a turn still running doesn't count;
- **the hold:** `wait` milliseconds, at most 15,000, which is also the
  default when `wait` is missing. A `wait` that isn't a number counts as
  15,000, a negative one as 0, and an empty one (`wait=`) as 0;
- **the browser leaving,** or the conversation being deleted.

`poll=now` counts as new from the start, so it ends after 250 ms: it answers
with what's there, or what of it fits in 250 ms. `poll=1` holds until
something new arrives.

**Signals.** Every poll is sent each signal's latest value, since each poll
opens a stream. They count as new only when they differ from the browser's.
The browser sends a fingerprint of the values it has in `signals`, and the
server compares it with a fingerprint of its own latest values. The
fingerprint is 32-bit FNV-1a over the UTF-16 code units of the JSON of the
`[name, payload]` pairs sorted by name, written in lowercase hex without
leading zeros. The client computes the same.

A server that has some signal values but lacks one the browser has, such as
one started after that signal was last sent, never matches the browser's
fingerprint. Each poll then ends after 250 ms, and the browser polls about
four times a second until that server hears every name again. A server with
no signal values at all makes no comparison, and its polls hold as usual.

**Wake turns between polls.** A wake turn can end while no poll is open. When
no wake turn is running, a poll is sent, first, every wake turn that ended in
the last 60,000 ms (the last 5 at most) with a number above `turn`, oldest
first: all it showed, its `released` included. That counts as new. Then the
poll is sent `{ type: "released" }`, so a browser that saw nothing of a turn
doesn't wait for one. When a turn is running, a poll gets what it has shown
so far, as a stream that joins does.

A poll landing on a server that hasn't served the conversation in the last
60,000 ms may miss a wake turn that ended meanwhile on another server. If a
turn is still running there, the poll is told `released` while it runs, and
the browser's next request gets 409 until it ends. Sticky sessions avoid
both.

## Wake turns on the stream

A wake turn's events go to every events stream the server has open for the
conversation, not only the one whose attempt started it. So another tab
shows the reply too, and holds its requests until the turn lets go.

**Across servers.** When the store has `publish`, a server publishes each
frame of a wake turn it runs, all but `context`, for the conversation. Every
other server with a stream on that conversation hears it, if its store has
`subscribe`. Publishing is best effort: a frame that fails, or is too long,
is missed by the others. A server starts listening for a conversation's wake
turns before it opens a stream for it, so a turn that starts after that is
never missed. A turn that was already running when it started listening is
never shown there: its frames are dropped, since its start wasn't heard. It
keeps listening for 60,000 ms after its last stream closes, so a polling
browser that comes back, perhaps to another server, finds the turn.

**Ordering.** Each turn carries its number in the conversation (the
`wake` field of its first `status` event). Frames from different servers can
arrive out of order. A turn takes over only with a number at least as high as
any seen. Frames of any other turn, including an older turn's late start, are
dropped.

**Joining part way.** A stream that opens while a wake turn runs is sent what
the turn has shown so far, starting with its `status: streaming`, so the
browser holds its requests and the reply's later text has a block to land in.
What it's sent is folded:

- each block once, with its text, status and progress up to date;
- each surface once, as it is now: a revision takes its surface's place,
  keeping the original's tool row, with `replaces` and `alsoReplaces` naming
  every earlier handle, for a browser that saw one of them;
- each surface's `ageMs` worked out again, so the browser counts its
  freshness from when it was stored;
- everything else in order.

**The end.** `released` ends the turn: the server has saved the conversation
and let it go, and the browser may send again. It's sent even if that save
failed; the conversation then stays held until its lease expires, and the
stream gets an `error`. The server keeps each ended turn for 60,000 ms, the
last 5 at most, for polls that missed its end.

**A wake attempt that fails before its `status: streaming`,** such as on a
store error, is never seen by any browser: its frames belong to no turn the
streams heard start. Nothing retries it.

## Wire events

### `WireEvent`

```ts
type WireEvent =
  | { type: "hello"; conversationId: string; model: string; events?: true }
  | { type: "notice"; seq: number; name: string; version: number; payload: unknown; handle?: string }
  | { type: "signal"; name: string; version: number; payload: unknown }
  | { type: "released" }
  | { type: "block_start"; block: Block }
  | { type: "text_delta"; id: string; text: string }
  | { type: "block_update"; id: string; status: string; ms: number; result: string }
  | ({ type: "progress"; toolId: string } & Progress)
  | {
      type: "ui_open"; handle: string; toolId: string; component: string; version: number; mode: string;
      staleAfterMs?: number; replaces?: string; alsoReplaces?: string[]; ageMs?: number;
    }
  | { type: "ui_props"; handle: string; props: unknown }
  | { type: "ui_state"; handle: string; state: "frozen"; selection?: unknown }
  | { type: "status"; status: ConversationStatus; wake?: number }
  | { type: "context"; messages: Message[]; modelTokens: number; uiTokens: number }
  | { type: "error"; message: string }
  | { type: "expired"; message: string };
```

| Event | Where | Meaning |
| --- | --- | --- |
| `hello` | `/chat`, `/start` | The conversation's id (new or given), the model adapter's `id`, and `events: true` when the browser should open the events stream |
| `notice` | events stream | A notice's payload, with its `seq` as the SSE id. Its model text is never sent. `handle` only when it was sent with one |
| `signal` | events stream | A signal's payload. No id |
| `released` | events stream | A wake turn is over: the server saved the conversation and let it go (or tried: it's sent even if the save failed). Also sent to a poll when no wake turn is running |
| `block_start` | turns | A transcript block starts: `user`, `assistant`, `tool` or `interaction`. See [`Block`](#block) |
| `text_delta` | turns | More text for the `assistant` block `id` |
| `block_update` | turns | A `tool` block finished or parked: `status` is `ok`, `awaiting` or `error` (init only), with the time in ms and the result text |
| `progress` | turns | A running tool's `ctx.progress`, for the `tool` block `toolId`. Only the fields named since the previous frame are present |
| `ui_open` | turns, events stream | A surface to mount. `toolId` is the `tool` block that showed it, or `""` for a `hai.update` revision. `mode` is `display` or `elicit`. `staleAfterMs` is present when the surface has a window. `replaces` names the handle it revises in place; `alsoReplaces`, earlier handles of the same surface, on a replayed revision. `ageMs` is how long ago the server stored it; absent means just now |
| `ui_props` | turns, events stream | The surface's props. For a revision from `hai.update`, carries the update notice's `seq` as the SSE id |
| `ui_state` | turns | A surface was frozen. `selection` is the clicked value on a `resolve`, absent when the question was closed out or withdrawn |
| `status` | turns | The conversation's status. `streaming` can come twice in a row: after init, and at a wake turn's start. `wake` is set on a wake turn's first `streaming`: the turn's number |
| `context` | turns | The whole history, sent when a turn ends or parks, and after `start`. `modelTokens` and `uiTokens` are rough estimates (see [`estTokens`](tools.md#esttokens)). Not sent to other servers |
| `error` | turns, events stream | Something failed: a refused click, a failed turn, a lost lease. The text is the error's message |
| `expired` | `/chat`, `/interact` | The conversation is past a surface's freshness window. The request was refused before the model ran, and every later `/chat` and `/interact` gets the same answer. Wake turns stop silently |

"Turns" means the response to a POST request, or the events stream for a
wake turn.

### `Block`

```ts
type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; ms?: number; result?: string; progress?: Progress }
  | { kind: "interaction"; id: string; handle: string; label: string };
```

A transcript block, as `block_start` sends it. A `tool` block starts with
status `running`. `progress` is set by the client, merged from `progress`
events, and on a block replayed to a stream that joins a wake turn. Ids look
like `b_12`: they count up from 1 in each `Hai`. The client matches blocks by
id for the whole conversation, so ids from two servers, or from a restarted
one, can repeat and overwrite an earlier block (see
[The server](server.md#how-a-turn-runs)). The client adds block kinds of its
own (see [The browser client](client.md)).

### `Emit`

```ts
type Emit = (event: WireEvent) => void;
```

How the runtime sends wire events: `hai.send`, `hai.start`, `hai.interact`,
`hai.wake` and `hai.streamOpened` each take one. For the POST routes,
`nodeHandler` passes one that writes an SSE frame. For `hai.wake`, the events
route passes one that writes to every stream on the conversation and
publishes to the other servers. For `hai.streamOpened`, one that keeps only
the latest of each signal while the socket is backed up.

## Security and proxies

**A conversation id is a bearer token.** `nodeHandler` does no
authentication. Anyone with a conversation's id can send to it, click in it,
read its notices and payloads as they arrive, and start its wake turns. The
built-in stores make unguessable ids. Before handing a request to
`nodeHandler`, check that the signed-in user owns that conversation, as for
any record. The events stream's `conversationId` is a query parameter, so
keep it out of logs that others can read.

**Anyone can create conversations.** A POST to `/chat`, or to `/start` with
an init tool, with a missing or unknown id creates and saves a new
conversation. So does `/interact`, which then answers `unknown handle`. Limit
who can reach the routes, and how often.

**Signals go to everyone.** A signal goes to every events stream of the
`Hai`, whatever its conversation, and anyone can make a conversation. So a
signal must never carry one user's data.

**A click can only name a declared action.** `/interact` takes
`{ handle, action, value }`. The server decides what the action means, from
the surface's contract, so a prompt injection in a tool result can't become a
button wired to an arbitrary tool.

**Don't let a proxy buffer the streams.** A browser counts a surface's
freshness from when its frames arrive, so a proxy that holds them back makes
the browser's deadlines late, and holds a wake turn's reply. The headers ask
proxies not to: `no-transform`, and `x-accel-buffering: no`, which nginx
honours. Turn response buffering off for these paths in any other proxy or
CDN. A proxy that won't is what the [polling](#polling) fallback is for, but
it can't speed up a POST response: behind such a proxy, a turn's reply
arrives all at once when the turn ends.
