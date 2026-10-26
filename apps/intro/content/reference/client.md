# The browser client

`@haikit/client` is the browser runtime: plain ES modules with no build step
and no dependencies. Its one optional peer dependency, `tailwindcss`, is for
an app that imports [`tailwind.css`](ui.md#tailwindcss). `createChat` owns
the transport, the transcript's blocks, and mounting surfaces and notices. It
draws nothing itself, apart from an error card for a component the registry
doesn't list. The default UI, `mountChat`, is built on it (see
[The default UI](ui.md)).

Exported by `@haikit/client`: `createChat`, and the types `Chat`,
`ChatState`, `SurfaceRecord`, `Block`, `WireEvent`, `Registry`,
`ComponentDef`, `MountCtx`, `SurfaceInstance`, `NoticeRegistry`,
`NoticeDef`, `NoticeMountCtx`, `NoticeInstance`, `SignalRegistry`,
`SignalHandler`, `NoticeRecord`, `Progress`, `ConversationStatus`,
`SurfaceMode`, `SurfaceState`.

Checked against `@haikit/*` 0.20.0. Source: `packages/client/src/index.js`
and `packages/client/src/index.d.ts`.

- [`createChat`](#createchat)
- [`Chat`](#chat): `start`, `send`, `interact`, `mount`, `mountNotice`,
  `reset`, `close`, `subscribe`
- [`ChatState`](#chatstate), [`SurfaceRecord`](#surfacerecord),
  [`Block`](#block)
- [Surfaces in the browser](#surfaces-in-the-browser): `Registry`,
  `ComponentDef`, `MountCtx`, `SurfaceInstance`, `SurfaceMode`,
  `SurfaceState`
- [Notices in the browser](#notices-in-the-browser): `NoticeRegistry`,
  `NoticeDef`, `NoticeMountCtx`, `NoticeInstance`, `NoticeRecord`
- [Signals in the browser](#signals-in-the-browser): `SignalRegistry`,
  `SignalHandler`
- [How each event changes the state](#how-each-event-changes-the-state)
- [Requests](#requests)
- [The events stream](#the-events-stream), and [polling](#polling)
- [Freshness in the browser](#freshness-in-the-browser)
- [Other types](#other-types): `WireEvent`, `Progress`,
  `ConversationStatus`

## `createChat`

```ts
function createChat(options: {
  endpoint?: string;
  registry: Registry;
  notices?: NoticeRegistry;
  signals?: SignalRegistry;
  eventsFallbackMs?: number;
  pollHoldMs?: number;
}): Chat;
```

Makes a chat. Nothing is sent until `start`, `send` or `interact` is called.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `endpoint` | `string` | `"/hai"` | Where the routes are: `nodeHandler`'s `basePath`, as a URL path or a full URL, with no trailing `/`. Requests go to `{endpoint}/chat`, `/start`, `/interact` and `/events` |
| `registry` | `Registry` | required | The components for surfaces, by surface name |
| `notices` | `NoticeRegistry` | `{}` | The components for notices, by notice name |
| `signals` | `SignalRegistry` | `{}` | The handlers for signals, by signal name |
| `eventsFallbackMs` | `number` | `8000` | How long the events stream may send nothing at all as it opens before the client polls instead (see [Polling](#polling)) |
| `pollHoldMs` | `number` | `15000` | When polling, how long each poll asks the server to hold if nothing new has come. The server allows at most 15,000. Set it lower behind a proxy that drops requests sooner |

None of the options is validated. `mountChat` takes `eventsFallbackMs` and
`pollHoldMs` too, and passes them through.

```js
import { createChat } from "@haikit/client";
import { renderTranscript } from "@haikit/client/transcript.js";

const chat = createChat({ registry, notices, signals: { online: (p) => (badge.textContent = p.count) } });
const log = document.querySelector("#log");
chat.subscribe(() => renderTranscript(log, chat));
renderTranscript(log, chat);
await chat.start();
```

## `Chat`

```ts
interface Chat {
  state: ChatState;
  start(): Promise<boolean>;
  send(text: string): Promise<boolean>;
  interact(handle: string, action: string, value: unknown): Promise<void>;
  mount(handle: string, element: HTMLElement): SurfaceInstance | null;
  mountNotice(seq: number, element: HTMLElement): NoticeInstance | null;
  reset(): void;
  close(): void;
  subscribe(fn: (state: ChatState, event: WireEvent) => void): () => void;
}
```

### `state`

The chat's state, a single object the chat changes in place. Read it in a
subscriber, and don't keep references to its parts across events. See
[`ChatState`](#chatstate).

### `start`

```ts
start(): Promise<boolean>;
```

Opens the conversation before the user types, with `POST {endpoint}/start`,
so a server with an init tool runs it now, and anything it shows is there
first.

- **It does nothing, resolving `false`,** once the conversation has begun
  (the last `context` event had messages), once the chat is closed, or once
  the conversation has expired.
- A server without an init tool answers with an empty stream and creates
  nothing. The first message then starts the conversation. It resolves
  `true` all the same.
- If init throws, the server records nothing, so calling `start` again tries
  again.
- It resolves the way `send` does.
- "Begun" is checked when it's called. A `start` queued before the
  conversation began is still sent, and resolves `true`, though the server
  then does nothing.

`mountChat` calls it when it opens and after a reset.

### `send`

```ts
send(text: string): Promise<boolean>;
```

Sends a typed message, with `POST {endpoint}/chat`. Requests are queued, one
at a time (see [Requests](#requests)), so `send` never refuses for being
busy.

**Resolves** to whether the server took the message:

| Resolves | When |
| --- | --- |
| `false` at once | the chat is closed, `text` is empty or only whitespace, or the conversation has expired. The expiry check happens before the first `await`, so a caller can check `state.expired` straight after calling |
| `false` later | the conversation expired while the message waited behind another request; `reset()` started a new conversation before its turn; the server answered 409 again after the retries; or the stream said `expired` |
| `true` | the server took it up, even if the turn then failed with an `error` event, or the response was an error status other than 409 |

A UI that cleared its input can put the text back on `false`. **It rejects**
if the request itself fails, such as on a network error, or if a subscriber
throws while its events are applied. If `reset()` or `close()` was called
meanwhile, it resolves instead: `true` if the server had already answered,
`false` if not. A message still queued when `close()` is called resolves
`false`.

The request's `conversationId` is read when it's sent, not when it's queued,
so a `send` queued behind `start` uses the id from `start`'s `hello`.

**The message shows as soon as its request goes out,** before the server
answers: something on the way, such as a proxy that inspects traffic, can
hold the whole response back until the turn has ended.

- It's added at the end of `blocks` as a `user` block with `pending: true`,
  with the id `s<n>`, where `n` is the number of blocks before it. `status`
  becomes `streaming`. Subscribers hear `{ type: "sending" }`.
- The server's `user` block takes its place: the pending block is taken out
  when it arrives, and the server's is added at the end.
- An `error` or `expired` that comes first takes it out, as does a response
  that ends, or fails, without the server's `user` block.
- When the response has ended, or failed, subscribers hear
  `{ type: "settled" }`. If the server sent no `status`, `error` or
  `expired` meanwhile, `status` goes back to what it was before.
- **A retry after a 409 says `streaming` again** if a wake turn's events set
  the status while the request waited (see [Requests](#requests)).
  Subscribers hear `{ type: "status", status: "streaming" }`, from the chat,
  not the server. If the server then sends no `status`, `error` or
  `expired`, `status` goes back to the one the wake turn left.

A message waiting behind another request isn't shown until its own request
goes out. If `reset()` is called meanwhile, the pending block goes with the
old conversation. If `close()` is, the pending block is taken out and
`status` goes back, as for a failed request, before subscribers hear
`closed`. No `settled` follows either.

### `interact`

```ts
interact(handle: string, action: string, value: unknown): Promise<void>;
```

Sends a click, with `POST {endpoint}/interact`. A component calls it through
its `send` (see [`MountCtx`](#mountctx)).

- **It's dropped, not queued, while any request is open or queued.** A
  double click on a picker row would otherwise resolve it and then queue a
  second click into `component is frozen`.
- It does nothing once the chat is closed or the conversation has expired.
  The expiry check runs first, so a click that can't be sent still closes a
  conversation whose timer slept through its deadline.
- It resolves when the response has been read. A dropped click resolves at
  once, the same way. It rejects as `send` does on a failed request.
- **`status` becomes `streaming` as the request goes out,** before the server
  answers, and subscribers hear `{ type: "sending" }`, then
  `{ type: "settled" }` once the response has ended or failed. If the server
  sent no `status`, `error` or `expired` meanwhile, `status` goes back to
  what it was before. No block is added.

The server's answer arrives as events: a refused click as an `error` block.

### `mount`

```ts
mount(handle: string, element: HTMLElement): SurfaceInstance | null;
```

Mounts the surface `handle` into `element`, from `registry`.

- Returns `null` without mounting if the chat is closed, there's no such
  surface, or its props haven't arrived yet. "Arrived" is a truthiness check,
  so a surface whose props are falsy (`false`, `0`, `""`) is never mounted:
  give a surface object props.
- **One instance per surface.** It first unmounts the instance the surface had,
  calling its `unmount`.
- **A surface name `registry` doesn't list** renders an error card:
  `element`'s text becomes `unknown component: <name>`, its class
  `hai-surface-error`, and it returns `null`. A page can't show a component it
  didn't register. (The lookup is a plain property read, so a name that
  exists on `Object.prototype`, such as `constructor`, throws a `TypeError`
  instead.)
- Otherwise it empties `element`, calls the component's `mount(element,
  props, ctx)`, and returns what that returns, `undefined` included. On an
  expired conversation, the element is sealed at once (see
  [Freshness in the browser](#freshness-in-the-browser)).

`renderTranscript` calls it for every `ui` block, once per surface.

### `mountNotice`

```ts
mountNotice(seq: number, element: HTMLElement): NoticeInstance | null;
```

Mounts the notice numbered `seq` into `element`, from `notices`.

- Returns `null` if the chat is closed or there's no such notice.
- It first unmounts what was mounted for that notice.
- A notice name `notices` doesn't list renders an error card:
  `unknown notice: <name>`, class `hai-surface-error`, and returns `null`. As
  with surfaces, the lookup is a plain property read.
- Otherwise it empties `element`, calls the component's `mount(element,
  payload, { seq, version, handle })`, and returns what that returns, or
  `null`.

### `reset`

```ts
reset(): void;
```

Starts over: the next `send` or `start` begins a new conversation.

- A request still queued is never sent, and one still open is aborted, so the
  new conversation never waits behind the old one's turn. Events already read
  from it are dropped.
- The events stream is closed.
- Every surface and notice is unmounted.
- The state goes back to empty: no conversation id, status `idle`, no
  blocks, surfaces, notices or signals, an empty `context` (so `start` runs
  again), no expiry. `model` is kept.
- Subscribers hear `{ type: "reset" }`. If one throws, `reset()` throws, after
  the state has been cleared.

It does nothing once the chat is closed.

### `close`

```ts
close(): void;
```

Ends the chat for good, as when the page showing it goes away. Requests and
the events stream stop, and every surface and notice is unmounted. A
message whose request was out is taken out of `blocks`, and `status` goes
back, as for a failed request (see [`send`](#send)). Subscribers hear `{ type: "closed" }`, every one even if one throws, and are
dropped. From then on `send` and `start` resolve `false`, `interact`,
`reset` and `close` do nothing, `mount` and `mountNotice` return `null`, and
`subscribe` adds no one.

### `subscribe`

```ts
subscribe(fn: (state: ChatState, event: WireEvent) => void): () => void;
```

Calls `fn` after every event the chat applies, with the state and the event,
and with five of the chat's own:

| Event | When |
| --- | --- |
| `{ type: "sending" }` | A `send` or `interact` request goes out. The state already shows it (see [`send`](#send)) |
| `{ type: "status", status: "streaming" }` | That request tries again after a 409, and a wake turn set the status while it waited. Only then: the server's `status` events come as they are |
| `{ type: "settled" }` | That request's response has ended, or failed. Not after a `reset()` or `close()` |
| `{ type: "reset" }` | `reset()` |
| `{ type: "closed" }` | `close()` |

`start` hears neither `sending` nor `settled`. Returns a function that
unsubscribes. After `close`, it returns a function that does nothing.

**A subscriber mustn't throw.** Subscribers are called directly, in turn,
so one that throws:

- stops the subscribers after it hearing that event;
- stops the rest of that response's events from being applied, and makes the
  `start`, `send` or `interact` promise reject;
- on `sending`, stops the request going out at all;
- on the events stream, counts as a dropped connection, which reconnects.

Events the chat doesn't know still reach subscribers, as do the ones it
applies. A repeated `notice`, and a second `expired`, don't.

## `ChatState`

```ts
interface ChatState {
  conversationId: string | null;
  model: string;
  status: ConversationStatus;
  blocks: Block[];
  surfaces: Map<string, SurfaceRecord>;
  context: { messages: any[]; modelTokens: number; uiTokens: number };
  expiresAt: number | null;
  expired: string | null;
  notices: NoticeRecord[];
  signals: Record<string, unknown>;
}
```

| Field | Meaning |
| --- | --- |
| `conversationId` | The conversation, from `hello`, or `null` before one |
| `model` | The model adapter's `id`, from `hello`. `""` until the first `hello` |
| `status` | From `status` events. It also becomes `idle` on `error` and `expired`, and `streaming` as a `send` or `interact` request goes out, going back once the response ends if the server set none (see [`send`](#send)) |
| `blocks` | The transcript, in order. See [`Block`](#block) |
| `surfaces` | Every surface shown, by its current handle. A revised surface moves to its new handle |
| `context` | The last `context` event: the whole history, and the token estimates |
| `expiresAt` | When the conversation goes out of date, in epoch milliseconds by this browser's clock, or `null` while nothing shown can |
| `expired` | The out-of-date message once the conversation has expired, else `null`. Final until `reset()` |
| `notices` | Every notice received, in `seq` order |
| `signals` | Each signal's latest payload, by name, since the conversation began. An object with no prototype, so a signal may be called anything, `__proto__` included |

## `SurfaceRecord`

```ts
interface SurfaceRecord {
  handle: string;
  component: string;
  version: number;
  mode: SurfaceMode;
  state: SurfaceState;
  props: unknown | null;
  selection?: unknown;
  instance: SurfaceInstance | null;
  element: HTMLElement | null;
  deadline?: number | null;
  window?: number;
}
```

| Field | Meaning |
| --- | --- |
| `handle` | Its current handle |
| `component`, `version` | The surface's name and version |
| `mode` | `display` or `elicit` |
| `state` | `live`, or `frozen` once answered, closed out or withdrawn |
| `props` | Its props, or `null` until `ui_props` arrives |
| `selection` | What the user picked, once frozen by a `resolve` click |
| `instance` | What the component's `mount` returned, while mounted |
| `element` | The element it's mounted in |
| `deadline` | When its freshness window ends, by this browser's clock, or `null` if never |
| `window` | Its freshness window, in milliseconds |

## `Block`

```ts
type Block =
  | { kind: "user"; id: string; text: string; pending?: true }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: string; ms?: number; result?: string; progress?: Progress }
  | { kind: "interaction"; id: string; handle: string; label: string }
  | { kind: "ui"; id: string; handle: string; toolId: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "expired"; id: string; message: string }
  | ({ kind: "notice"; id: string } & NoticeRecord);
```

The first four come from the server, in `block_start` events (see
[HTTP routes and the wire](http.md#block)). The client adds a `user` block
of its own while a message's request is out, and four other kinds:

| Kind | Made from | Id | Where it goes |
| --- | --- | --- | --- |
| `user`, with `pending: true` | a `send` request going out | `s<n>`, where `n` is the number of blocks before it | at the end. Taken out when the server's `user` block arrives, on an `error` or `expired` first, or when the response ends without one (see [`send`](#send)) |
| `ui` | a `ui_open` for a surface not seen before | `ui:<first handle>` | at the end. `handle` follows revisions; `toolId` is the `tool` block that showed it |
| `error` | an `error` event | `e<n>`, where `n` is the number of blocks before it | at the end |
| `expired` | an `expired` event, or the local deadline | `x<n>`, likewise | at the end |
| `notice` | a `notice` event | `n:<seq>` | right after its surface's `ui` block, after the notices already there, when it names a surface shown here; otherwise at the end. One that arrives before its surface moves next to it when the surface arrives |

## Surfaces in the browser

### `Registry`, `ComponentDef`

```ts
type Registry = Record<string, ComponentDef<any>>;

interface ComponentDef<P = any> {
  mount(element: HTMLElement, props: P, ctx: MountCtx): SurfaceInstance | null | void;
}
```

The allowlist of components, by surface name. A component's `mount` draws
the surface into `element`, given its props (the JSON form of what the
server's schema returned) and a `MountCtx`. It may return a
`SurfaceInstance`.

### `MountCtx`

```ts
interface MountCtx {
  readonly handle: string;
  mode: SurfaceMode;
  state: SurfaceState;
  selection?: unknown;
  send(action: string, value: unknown): Promise<void>;
}
```

| Field | Meaning |
| --- | --- |
| `handle` | The surface's handle as it is now: it follows revisions |
| `mode` | `display` or `elicit` |
| `state` | `live` or `frozen`, when mounted |
| `selection` | What the user picked, when the surface is mounted already frozen |
| `send` | The component's only way to reach the server: `chat.interact(<current handle>, action, value)`. `action` must be an action the surface's contract declares. After a revision, it names the new handle |

### `SurfaceInstance`

```ts
interface SurfaceInstance {
  freeze?(selection?: unknown): void;
  expire?(): void;
  unmount?(): void;
  update?(props: any): void;
}
```

Every hook is optional. An error a hook throws is reported as an uncaught
error, after the chat has finished what it was doing, so it can't stop an
event being applied, a reset or a close part way through. An `expire` that
throws still leaves every surface sealed: each element is made `inert`
before its hook is called.

| Hook | Called when |
| --- | --- |
| `freeze(selection)` | The surface was frozen (`ui_state`): answered, with the picked value, or closed out or withdrawn, with none |
| `expire()` | The conversation went out of date. The element is already `inert`, with `data-expired` set, so nothing inside can reach the server; this is only for looks |
| `unmount()` | The surface goes away: `reset()`, `close()`, or it's mounted again. Release timers, subscriptions or a React root here |
| `update(props)` | The surface was revised in place. Keep what the component holds, such as its scroll or sort. Without `update`, or when `mount` returned no instance at all, the component is mounted again in the same element |

### `SurfaceMode`, `SurfaceState`

```ts
type SurfaceMode = "display" | "elicit";
type SurfaceState = "live" | "frozen";
```

### Revisions in the browser

A `ui_open` with `replaces` (or `alsoReplaces`) naming a surface on screen
moves that surface's record to the new handle, in place: the same
component, element and `ui` block. Its props stay until the new `ui_props`
arrives. Then the component's `update(props)` is called, or, without one,
or when its `mount` returned nothing, the component is mounted again in the
same element. A surface not yet mounted is drawn with the latest props when
it is. Every earlier handle
leads to the new one, so a notice naming an old handle goes beside the
surface as it is now.

A revision can overtake the surface it replaces, when the request that
showed the original is held back on its way. The revision then stands, and
the original, when it arrives, isn't shown. Its tool row is kept for the
revision.

## Notices in the browser

### `NoticeRegistry`, `NoticeDef`

```ts
type NoticeRegistry = Record<string, NoticeDef<any>>;

interface NoticeDef<P = any> {
  mount(element: HTMLElement, payload: P, ctx: NoticeMountCtx): NoticeInstance | null | void;
}
```

The allowlist of notice components, by notice name. It's kept apart from the
surface registry, so a notice and a surface may share a name. A notice
component gets no `send`: nothing in it can reach the server.

### `NoticeMountCtx`, `NoticeInstance`

```ts
interface NoticeMountCtx {
  seq: number;
  version: number;
  handle?: string;
}

interface NoticeInstance {
  unmount?(): void;
}
```

`handle` is the surface the notice was sent beside, if any. `unmount` is
called when the notice goes away: `reset()`, `close()`, or it's mounted
again.

### `NoticeRecord`

```ts
interface NoticeRecord {
  seq: number;
  name: string;
  version: number;
  payload: unknown;
  handle?: string;
}
```

A notice as the events stream delivers it: no model text.

## Signals in the browser

### `SignalRegistry`, `SignalHandler`

```ts
type SignalRegistry = Record<string, SignalHandler<any>>;
type SignalHandler<P = any> = (payload: P, ctx: { version: number }) => void;
```

The handlers for signals, by name. Each `signal` event sets
`state.signals[name]`, then calls the handler for that name, if the registry
has one of its own (not one an object inherits, such as `toString`). An error
the handler throws is reported as an uncaught error, without stopping the
chat. Subscribers also hear each `signal` event.

A handler may be called again with a value it already had: every stream that
opens, and every poll, is sent each signal's latest value (see
[Signals and presence](signals.md#haisignal)). Signals arrive only while the
conversation's events stream is open, which is from the first `hello`: after
`start` on a server with an init tool, or after the first message
otherwise.

## How each event changes the state

| Event | What the chat does |
| --- | --- |
| `hello` | Sets `conversationId` and `model`. With `events: true`, opens the events stream for the conversation, if it isn't open already |
| `notice` | Ignored if its `seq` isn't above the last notice's. Otherwise added to `notices`, and a `notice` block placed |
| `signal` | Sets `signals[name]`, and calls the handler |
| `block_start` | A `user` block first takes out the pending message, if there is one. Then adds the block, or, if a block with that id exists (a stream rejoining a wake turn), brings it up to date |
| `text_delta` | Appends to the block's text |
| `block_update` | Merges the event's fields into the block |
| `progress` | Merges the fields into the `tool` block's `progress` |
| `ui_open` | Ignored for a handle already shown. Ignored for a handle a revision already replaced, except that the revision takes its tool row. For a revision, moves the surface in place (see [Revisions in the browser](#revisions-in-the-browser)). Otherwise adds a surface record and a `ui` block. Then sets the surface's deadline |
| `ui_props` | Sets the surface's props. For a revision, calls `update`, or mounts again |
| `ui_state` | Sets the surface's `state` and `selection`, and calls `freeze` |
| `status` | Sets `status` |
| `context` | Sets `context` |
| `error` | Takes out the pending message, if there is one. Adds an `error` block, and sets `status` to `idle` |
| `expired` | Once only: takes out the pending message, if there is one, sets `expired`, sets `status` to `idle`, adds an `expired` block, and seals every surface |
| `released` | Lets requests waiting behind a wake turn go (see [The events stream](#the-events-stream)) |

## Requests

`start`, `send` and `interact` post JSON, `{ conversationId, ...body }`, and
read the response as server-sent events.

- **One at a time.** Each request waits for the previous response to end, so
  the chat never collides with itself. The server sends `idle` or `awaiting`
  before it releases the conversation, so waiting for the status alone would
  send the next request too early, into a 409.
- **Behind a wake turn too.** While a wake turn runs on the events stream,
  requests wait until its `released`.
- **Shown as it goes out.** A `send` or `interact` request sets `status` to
  `streaming` when it goes out, after any wait, and a `send` shows its
  message as a pending block, before the response's first byte (see
  [`send`](#send)). `start` doesn't.
- **409 once:** the chat waits 150 ms, and any wake turn that has started,
  then tries once more. That covers the previous request's tail. A second tab
  holding the conversation is reported, as an `error` block with the server's
  message, or `another turn is already in flight` if it has none. A `send` or
  `interact` request says `streaming` again as it tries, if a wake turn
  changed the status while it waited (see [`send`](#send)), and so does each
  try below.
- **409 after a lost wake turn:** if the events connection dropped while a
  wake turn ran, the turn's `released` was lost with it. The next request
  then keeps trying, waiting 250 ms, then twice as long each time up to
  2,000 ms, for up to 120,000 ms, the default lease time.
- **Other error statuses** become an `error` block: the response's
  `{ error }` text, or `request failed (<status>)`.
- **`reset()` and `close()`** abort the request open and drop the ones
  queued.

## The events stream

When `hello` says `events: true`, the chat opens
`GET {endpoint}/events?conversationId=…` and keeps it open until `reset()` or
`close()`. It's opened once per conversation. It stays open when the
conversation expires: a notice such as a confirmation is still true then.

- **Resuming.** Once it has seen a notice, each request sends
  `Last-Event-ID`: the last notice id it has seen, revisions' included. So a
  reconnect gets only what it missed.
- **Reconnecting.** A connection that drops is opened again after 1,000 ms,
  then twice as long each time, up to 30,000 ms. The wait goes back to
  1,000 ms after a connection that delivered an event, or stayed open for
  30,000 ms.
- **404 stops it.** The server has no such conversation, or serves no events
  stream. It isn't tried again for that conversation. Any other error status
  is retried, with the same backoff, for as long as the chat lasts.
- **Wake turns.** A `status: streaming` on the stream starts a wake turn.
  Requests wait until its `released`, which the server sends only once it has
  saved and let go of the conversation. If the connection drops part way, the
  chat stops waiting, and gives the next request longer instead (see
  [Requests](#requests)).

### Polling

The server sends a comment the moment a stream opens. A stream that brings no
bytes at all within `eventsFallbackMs` means something on the way, such as an
HTTPS-inspecting proxy, is holding it back until it ends, which a stream
never does. The chat then polls instead: requests whose responses end.

- **Switching** happens once, and the browser remembers it in `localStorage`,
  under `hai:events-poll`, as the time it switched. For 24 hours after, every
  chat on that origin polls from the start. Where `localStorage` can't be
  used, nothing is remembered.
- **Each poll** asks with `poll`, `wait=<pollHoldMs>`, `turn=<the last wake
  turn seen to end>` and `signals=<a fingerprint of state.signals>`. The first
  poll is `poll=now`, which the server answers within about 250 ms. Later ones are `poll=1`, which
  the server holds until something new arrives, or for `wait` (see
  [HTTP routes and the wire](http.md#polling)).
- **The next poll** starts as soon as one ends, but at least 250 ms after the
  previous one started. A poll that fails, rather than ending, backs off as a
  stream does. A poll that ends normally resets that backoff, so the next
  failure waits 1,000 ms again.
- **A 404** stops polling as it stops a stream, and ends the wait on any wake
  turn the browser was following, so requests aren't left waiting.

Notices, revisions, signals and wake turns all arrive by polling, a little
later than they would stream. A turn's reply on `/chat` or `/interact` isn't
helped: behind such a proxy, it arrives all at once when the turn ends.

## Freshness in the browser

The chat knows each surface's freshness window, from `ui_open`'s
`staleAfterMs`, so an open tab closes the conversation on time, without
waiting for a refused request.

- **Each surface's deadline** is its window, counted from the earlier of two
  times: when the request that showed it was sent, and now minus its
  `ageMs`. The server stamps a surface no earlier than the request that made
  it arrived, so this deadline is never later than the server's. For a wake
  turn, the request's time is when the turn's `streaming` arrived. A revision
  from `hai.update` is counted from its `ageMs` alone.
- **A revised surface's deadline stops counting.** The revision brings its
  own.
- **`expiresAt`** is the earliest deadline among the surfaces. One timer waits
  for it. When it passes, the chat applies an `expired` event of its own:
  `This conversation is out of date — results shown here were only valid for
  <window>. Start a new conversation for current results.` `<window>` is the
  window of the surface whose deadline came first, in its largest whole unit,
  rounded down: `1 hour` for 90 minutes, `15 minutes`, or `under a second`. `start`, `send`
  and `interact` also check the clock, for a timer that slept through the
  deadline with the laptop.
- **Sealing.** On `expired`, from the server or the timer, every mounted
  surface's element is made `inert` and given `data-expired`, and its
  `expire` hook is called. A surface mounted later is sealed as it mounts.
  From then on `send` and `start` resolve `false`, and `interact` does
  nothing, until `reset()`.

## Other types

### `WireEvent`

```ts
type WireEvent = { type: string } & Record<string, any>;
```

The client's own loose type for a frame. See
[HTTP routes and the wire](http.md#wireevent) for every event's shape.

### `Progress`

```ts
interface Progress {
  message?: string;
  done?: number;
  total?: number;
}
```

A `tool` block's `progress`: every `progress` event for it, merged.

### `ConversationStatus`

```ts
type ConversationStatus = "idle" | "streaming" | "awaiting";
```

## Serving it

The package ships source, not a bundle. With a bundler, import it normally.
With none, serve `node_modules/@haikit/client/src/` under a URL prefix, such
as `/hai-client/`, and import the modules from there. Any file in
`src/` can be imported, through the package's `./*` export, but only the
modules on this page and [The default UI](ui.md) are its API.
