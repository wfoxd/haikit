# Notices

A notice is something the server tells a conversation outside any request,
such as a booking a webhook confirmed. Like a surface, it has two halves: its
payload goes to the browser over the events stream, and its *model text* goes
to the model with the next message the conversation records for the user's
side: a typed message, a click, the conversation's start, or a wake turn. A *passive*
notice waits for the user. A *wake* notice starts a turn of its own, so the
model can respond without being asked.

Exported by `@haikit/core`: `defineNotice`, `Notice`, `NoticeImpl`,
`NoticeImplDef`, `AnyNoticeImpl`, `NoticeKind`, `Notify`, `NotifyOptions`,
`NoticeRecord`. By `@haikit/server`: `WakeOutcome`, and the `Hai` methods
`notify` and `wake`.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/runtime.ts` and `packages/server/src/routes.ts`.

- [Declaring a notice](#declaring-a-notice): `defineNotice`, `Notice`,
  `NoticeKind`
- [Implementing it](#implementing-it): `Notice.implement`, `NoticeImplDef`,
  `NoticeImpl`, `AnyNoticeImpl`
- [Sending one](#sending-one): `hai.notify`, `Notify`, `NotifyOptions`
- [What the model hears](#what-the-model-hears)
- [What the browser gets](#what-the-browser-gets)
- [Wake turns](#wake-turns): `maxWakes`, `hai.wake`, `WakeOutcome`
- [The stored record](#the-stored-record): `NoticeRecord`

## Declaring a notice

### `defineNotice`

```ts
function defineNotice<P, K extends NoticeKind = "passive">(def: {
  name: string;
  version: number;
  kind?: K;
  payload: Schema<P>;
}): Notice<P, K>;
```

Declares a notice's contract. Put it in a module both halves import: the
server implements it and sends it, and the browser renders its payload with
the component registered under its name in the client's `notices` registry.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | required | The notice's name. `createHai` registers it under this name, every record stores it, and the browser looks up its component by it |
| `version` | `number` | required | Stored with each notice and sent to the browser. HaiKIT doesn't compare versions |
| `kind` | `"passive" \| "wake"` | `"passive"` | `passive` waits for the user. `wake` starts a turn (see [Wake turns](#wake-turns)) |
| `payload` | `Schema<P>` | required | Validates the payload `hai.notify` is given. What it returns is what's stored and sent, so it must survive JSON (see [Surfaces: schemas](surfaces.md#schemas)) |

**Returns** a `Notice<P, K>`.

A notice can't send anything back. Its component gets no `send`. A notice
that needs a button should show a surface instead.

### `Notice<P, K>`

```ts
interface Notice<P, K extends NoticeKind = "passive"> {
  readonly name: string;
  readonly version: number;
  readonly kind: K;
  readonly payload: Schema<P>;
  implement(impl: NoticeImplDef<P, K>): NoticeImpl<P, K>;
}
```

What `defineNotice` returns, with `kind` set to `"passive"` when left out.

### `NoticeKind`

```ts
type NoticeKind = "passive" | "wake";
```

## Implementing it

### `Notice.implement`

```ts
implement(impl: NoticeImplDef<P, K>): NoticeImpl<P, K>;
```

Pairs the contract with its server half. Returns `{ notice, impl }`. List the
result in `createHai({ notices })`.

**Registration.** `createHai` registers each implementation under its
notice's name, and throws for two with the same name: `two notices are named
"<name>"`. Registering any notice makes the browser open the events stream
for every conversation (see [The server](server.md)).

### `NoticeImplDef<P, K>`

```ts
interface NoticeImplDef<P, K extends NoticeKind = NoticeKind> {
  model: (payload: P) => K extends "wake" ? string : string | null;
}
```

| Field | Meaning |
| --- | --- |
| `model` | Given the validated payload, returns what the model hears of the notice, or `null` for nothing. A `wake` notice must return a string: a turn started by a notice the model can't hear would have nothing to respond to |

`model` runs once, synchronously, when the notice is sent, and its text is
stored with the notice. A `model` that throws rejects `hai.notify`, and
nothing is stored. An async one returns a promise, which `hai.notify`
refuses with the `TypeError` below. A later deploy that renames the notice or
changes `model` can't change what the model hears of one already sent, with
one exception: a deploy that registers no notices and leaves `updates` off
stops reading notices altogether, so unread ones are never heard. Return `null` only when the
model genuinely doesn't need to know. Otherwise the browser shows something
the model goes on talking past.

The payload can be large, because only the browser receives it. Put in the
model text what the next turn will need, as a digest does.

### `NoticeImpl`, `AnyNoticeImpl`

```ts
interface NoticeImpl<P, K extends NoticeKind = NoticeKind> {
  readonly notice: Notice<P, K>;
  readonly impl: NoticeImplDef<P, K>;
}

type AnyNoticeImpl = NoticeImpl<any, any>;
```

What `implement` returns, and what `hai.notify` takes. `AnyNoticeImpl` is the
element type of `HaiConfig.notices`.

## Sending one

### `hai.notify`

```ts
readonly notify: Notify;

type Notify = <P, K extends NoticeKind>(
  conversationId: string,
  notice: NoticeImpl<P, K>,
  payload: NoInfer<P>,
  options?: NotifyOptions,
) => Promise<{ seq: number }>;
```

Sends a notice to a conversation. Resolves to its sequence number in that
conversation. It's a property holding an arrow function, so it can be passed
around without binding.

| Parameter | Type | Meaning |
| --- | --- | --- |
| `conversationId` | `string` | The conversation to tell |
| `notice` | `NoticeImpl<P, K>` | The implementation registered in `createHai({ notices })` |
| `payload` | `P` | Typed from the contract, and validated against its schema. What the schema returns is what's stored, sent and given to `model` |
| `options.handle` | `string` | A surface the browser shows the notice beside. See [`NotifyOptions`](#notifyoptions) |

**Steps,** in order:

1. **The notice must be registered.** Unless `notice` is the implementation
   registered under its name, it rejects with `notice "<name>" is not
   registered: list it in createHai({ notices })`.
2. **The payload is validated** with the contract's `payload` schema. The
   schema's error rejects the call.
3. **`model` is called** with the validated payload. If it doesn't return a
   string (for a wake notice) or a string or `null` (for a passive one), the
   call rejects with a `TypeError`: `notice "<name>": model() must return a
   string, for a wake notice`, or `… must return a string or null`.
4. **`options.handle`, when given, must be a stored surface** of this
   conversation. Otherwise it rejects with `notice "<name>": no surface
   <handle> in conversation <conversationId>`. That includes a conversation
   that doesn't exist.
5. **The notice is stored**, numbered and timestamped by the store. A
   conversation that doesn't exist makes both built-in stores reject with
   `conversation <conversationId> does not exist`.

**Behaviour.**

- **It takes no lease.** It works while a turn is streaming, while one is
  parked, and with nobody connected. It never changes the conversation's
  history.
- **It never runs a turn itself.** A passive notice waits for the user. A wake
  notice's turn is started by the events route, while a browser has the
  events stream open (see [Wake turns](#wake-turns)).
- **It's unrelated to any request.** Call it from webhooks, job queues or a
  tool's background work. To call it from a tool, keep `ctx.conversationId`.
  A notice sent while a turn runs isn't heard in that turn: the tool results
  a turn records between model calls carry no notices.
- **It doesn't check freshness.** A notice to an expired conversation is
  stored and shown in the browser, but the model never hears it: every
  request on the conversation is refused before it records a message, and no
  wake turn starts.

### `NotifyOptions`

```ts
interface NotifyOptions {
  handle?: string;
}
```

`handle` names a surface from the conversation, such as an action handler's
`ctx.handle`. The browser shows the notice beside it: after its surface's
block, after any notices already there. The model never sees the handle.

It's checked against the stored payloads only, not against the conversation's
history. A surface left behind by an overtaken turn passes too, until a
cleanup removes its row. That's harmless: the handle only places the notice.

## What the model hears

A notice reaches the model with the next message the conversation records
for the user's side: a typed message, a click, the start of the conversation
(with an init tool), or a wake turn. The tool results a turn records between
model calls don't carry notices. Every notice the history hasn't taken in
rides in that message, oldest first, as text blocks: ahead of what the user
did, or after the tool results on a `resolve` click:

| Notice | Text block |
| --- | --- |
| A notice whose model text is a string | `[App notification: <name>] <model text>` |
| An update notice, from `hai.update` | `[UI update] <model text>` (see [Revisions](revisions.md)) |
| A notice whose model text is `null` | nothing, but it counts as taken in |

Where the blocks go in the message:

- **A typed message:** the notices, then the typed text. The message's content
  is that list of text blocks. A message with no notices keeps its plain
  string content, so a conversation that never gets a notice has exactly the
  history it would have had without them.
  - While a question waits, the question is closed out first, in a message of
    its own. The notices go in the message that follows, with the typed text.
- **A `resolve` click:** after the tool results, which the Messages API
  requires to come first.
- **An `inform` click:** the notices, then `[UI interaction] <label>`.
- For either kind of click, the notices are read after the action handler
  returns, so one the handler sent rides with the click.
- **The start of a conversation with an init tool:** in the first user
  message, ahead of the user's first message, or ahead of
  `[conversation started]` when the client calls `start()`.
- **A wake turn:** all of them, passive ones too, then `[The user has not said
  anything. The notifications above arrived on their own.]`.

The conversation records how far it has taken notices in, in
`noticedThrough`. That's committed with the message that carries them, so a
request whose save is discarded leaves them unread for the request that wins.
A request refused before it records a message, an expired conversation for
instance, takes none in.

## What the browser gets

The events stream (`GET {base}/events`) sends each notice as a `notice` event,
with the notice's `seq` as its SSE id:

```
id: 7
data: {"type":"notice","seq":7,"name":"hold_confirmed","version":1,"payload":{…},"handle":"ui_03"}
```

`handle` is present only when the notice was sent with one. The model text
never goes on the stream: the browser sees it only as part of the history,
in the `context` event, once a turn has taken the notice in.

A stream that opens sends every notice after where the browser has got to,
then each as it lands. Where the browser has got to is the `Last-Event-ID`
header on a reconnect, or else the `after` query parameter. Update notices go
out as the revisions they announce, not as `notice` events. See
[HTTP routes and the wire](http.md) for the stream, and
[The browser client](client.md) for the `notices` registry, `state.notices`
and how notice blocks are placed.

## Wake turns

A wake notice asks for a turn. Only the events route starts one: when a
stream (or a poll) on a server knows of a wake notice, read there from the
store, newer than the last one that server has already settled. That
includes one that arrived while nobody was watching (see
[HTTP routes and the wire](http.md#starting-wake-turns)). So **a wake turn starts only from an open events stream or a
poll**. A wake notice sent while nobody is connected waits. The next stream
to open starts its turn, if it still can. Once a turn has started, it runs to
the end and is saved even if every stream closes.

A turn that was limited, or found nothing to do, is settled: nothing tries
it again until a newer notice arrives. A turn that failed settles nothing:
the next stream to open, or the next poll, tries again, until `maxWakes`
holds it back. A stream that stays open doesn't retry it until it reads a
newer notice. The route also retries while the conversation is busy.

The turn's events go to every events stream this process has open for the
conversation. With a store that implements `publish` and `subscribe`, they
also go to streams on other servers, all but the `context` event. See
[HTTP routes and the wire](http.md#wake-turns-on-the-stream).

### `maxWakes`

```ts
maxWakes?: { count: number; perMs: number };   // HaiConfig; default { count: 1, perMs: 60_000 }
```

How many wake turns a conversation may start in any window of `perMs`
milliseconds. A wake turn is a model call nobody asked for, and a tool inside
one could send another wake notice. Past the limit, a wake notice rides the
user's next message instead, like a passive one. The browser still shows it
at once.

`createHai` throws a `RangeError` unless `count` is a safe integer of at least
1 and `perMs` a positive, finite number:

```
maxWakes must be a whole count of at least 1 per a positive, finite number of milliseconds (got <count> per <perMs>)
```

The same limit applies to a `hai.update` sent with `wake: true`.

### `hai.wake`

```ts
wake(conversationId: string, emit: Emit): Promise<WakeOutcome>;
```

Starts a turn for the wake notices a conversation hasn't taken in, if it can
take one now, and streams the turn's events through `emit`. The events route
calls it. You only need to call it yourself if you serve the events stream
yourself.

It takes the conversation's lease like any request, and releases it before
it resolves. Its decisions, in order:

| Condition | Outcome |
| --- | --- |
| No such conversation | `"idle"` |
| Another request holds the lease | `"busy"`. The events route tries again, waiting 250 ms, then twice as long each time up to 5,000 ms, while the stream stays open |
| An update notice the conversation still owes is appended first (see [Revisions](revisions.md)) | (then carries on) |
| The conversation hasn't begun (no messages) | `"idle"`: a turn now would skip the init tool |
| A question is waiting | `"idle"`: a user message would follow a tool call with no result |
| The conversation has expired | `"idle"` |
| No unread wake notice newer than the last that already woke or was limited | `"idle"` |
| `maxWakes` turns already started within the last `perMs` | `"limited"`: these notices never wake again, and ride the user's next message |
| Otherwise | the turn runs: `"woke"`, or `"failed"` if it fails |

An error from the store after the conversation is loaded also gives
`"failed"`: storing an owed update notice, reading payloads for the freshness
check, or reading notices. `emit` then gets an `error` event and
`released`, though no `streaming` status was sent and no wake was counted.
A `loadConversation` error other than `ConversationBusy` rejects the call.
When `hai.wake` rejects, the events route sends an `error` event to that
stream.

When the turn runs:

1. The time is recorded against `maxWakes`, before anything else, so a turn
   that fails still counts. A model that's down can't be asked again on every
   notice and every reconnect.
2. One user message is recorded: every unread notice's text block, passive
   ones too, then `[The user has not said anything. The notifications above
   arrived on their own.]`.
3. The conversation's wake turn count goes up by one. `emit` gets
   `{ type: "status", status: "streaming", wake: <that number> }`.
4. The conversation is saved, before the model runs, so a stream retrying
   meanwhile finds nothing left to wake for.
5. The turn runs like any other: model, tools, surfaces.

**If the turn fails,** `emit` gets an `error` event with the error's message,
and the outcome is `"failed"`:

- **Before any tool call,** the conversation is put back as it was. The
  notices are unread and could wake again. But the recorded time and the
  raised wake turn count stay. With the default `maxWakes` of 1 a minute, an
  attempt within the minute is `"limited"`, and the notices then ride the
  user's next message instead.
- **After a tool call,** what happened is kept, with the call and its result
  where the model can see them. The conversation goes back to `idle`, and the
  notices never wake again. Undoing it would let the notice run the tool a
  second time, booking or charging twice. A tool call counts once a model
  reply in the turn asked for one, even an unknown tool or one with invalid
  input.
- **If the lease was lost** (`StaleLease`), nothing more is saved.

**At the end,** whatever the outcome, once the conversation was loaded, the
lease is released and the conversation saved, unless the lease was lost. For
`"limited"`, that save is what records the notices as unable to wake. For
`"woke"` and `"failed"`, `emit` then gets `{ type: "released" }`, which tells
the browser it may send again. `released` is sent even if the save fails, or
was skipped for a lost lease. The conversation then stays held until its
lease expires, and a message sent meanwhile is refused as busy. A lost lease
found by that save goes to `emit` as an `error` event. Any other save failure
rejects the call, after `released`.

### `WakeOutcome`

```ts
type WakeOutcome = "woke" | "failed" | "busy" | "limited" | "idle";
```

What `hai.wake` did: it ran a turn, ran one that failed, found the
conversation busy, was held back by `maxWakes`, or had nothing to do.

## The stored record

### `NoticeRecord`

```ts
interface NoticeRecord {
  conversationId: string;
  seq: number;
  createdAt: number;
  name: string;
  version: number;
  kind?: "wake";
  payload: unknown;
  model: string | null;
  handle?: string;
  replaces?: string;
}
```

A notice as stored. Append-only: nothing about a notice changes once it's
written.

| Field | Meaning |
| --- | --- |
| `conversationId` | The conversation it belongs to |
| `seq` | Its number within the conversation. Strictly increasing in commit order, so a reader that has seen one number never later finds a smaller one appear. Gaps are allowed |
| `createdAt` | When it was stored, in epoch milliseconds |
| `name`, `version` | The contract's name and version. For an update notice, the surface's |
| `kind` | `"wake"` for a wake notice, and for an update notice sent with `wake: true`. Absent otherwise |
| `payload` | The payload the schema returned, as the store keeps it: as JSON in both built-in stores. `null` on an update notice |
| `model` | The model text computed when it was sent. Never sent on the events stream |
| `handle` | The surface the browser shows it beside. For an update notice, the revision's handle |
| `replaces` | Only on an update notice: the handle the revision replaced. The events stream sends such a notice as the revision's `ui_open` and `ui_props` |

The store numbers and stamps the record: `StoreAdapter.putNotice` takes
everything but `seq` and `createdAt`. See [Stores](stores.md) for what a store
must guarantee about the numbering.
