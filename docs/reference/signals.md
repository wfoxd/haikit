# Signals and presence

A signal is a broadcast to every open browser: something everyone should see
now and nobody needs later, such as how many people are online. It belongs to
no conversation, is never stored, and never reaches the model or the
transcript. Presence is the count a server keeps of conversations with an
events stream open, across every server sharing the store.

Exported by `@haikit/core`: `defineSignal`, `Signal`, `SendSignal`. By
`@haikit/server`: the `Hai` methods `signal`, `onPresence` and
`streamOpened`, and the `HaiConfig` options `signals` and `presence`.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/runtime.ts`, `packages/server/src/signals.ts` and
`packages/server/src/routes.ts`.

- [Signals](#signals): `defineSignal`, `Signal`, `HaiConfig.signals`,
  `hai.signal`, `SendSignal`
- [Presence](#presence): `hai.onPresence`, `HaiConfig.presence`
- [Serving the stream yourself](#serving-the-stream-yourself):
  `hai.streamOpened`
- [Across servers](#across-servers)

## Signals

### `defineSignal`

```ts
function defineSignal<P>(def: { name: string; version: number; payload: Schema<P> }): Signal<P>;
```

Declares a signal's contract. Put it in a module both halves import, so the
payload is typed on both sides. There's no server half to implement: nothing
about a signal is for the model.

| Parameter | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | The signal's name. The server registers it under this name, and the browser's `signals` registry maps it to a handler |
| `version` | `number` | Sent with every signal, and passed to the browser's handler as `{ version }`. HaiKIT doesn't compare versions |
| `payload` | `Schema<P>` | Validates what `hai.signal` sends |

**Returns** `{ name, version, payload }`.

### `Signal<P>`

```ts
interface Signal<P> {
  readonly name: string;
  readonly version: number;
  readonly payload: Schema<P>;
}
```

### `HaiConfig.signals`

```ts
signals?: Signal<any>[];
```

The signals the app sends. `createHai` throws for two with the same name:
`two signals are named "<name>"`. Listing any signal does two things:

- **The browser opens the events stream** for each conversation, since that's
  how a signal reaches it. It opens it once the server's `hello` says to,
  which only `/chat` and `/start` send. So a tab receives signals only once
  its conversation has begun: on its first message, or, with an init tool, as
  soon as the client calls `start()` (the default UI does when it opens).
  Without an init tool, `/start` creates no conversation, so a tab gets no
  signals until the user's first message.
- **The server starts hearing the other servers' signals** as soon as it's
  created, so a stream that opens later is sent their latest values.

### `hai.signal`

```ts
readonly signal: SendSignal;

type SendSignal = <P>(signal: Signal<P>, payload: NoInfer<P>) => void;
```

Sends a signal to every open events stream of this `Hai`, and through the
store to the other servers. It's a property holding an arrow function, so it
can be passed around without binding.

**Throws** synchronously:

- for a signal that isn't the one listed under its name in `signals`:
  `signal "<name>" is not registered: list it in createHai({ signals })`;
- the schema's error, for a payload that fails it;
- a `TypeError` while a stream is open, for a payload that can't be written
  as JSON, such as a `BigInt` or a cycle. Some streams may have it by then,
  and it isn't published.

**Behaviour.**

- **It goes out at once** as a `signal` event,
  `{ type: "signal", name, version, payload }`, to every events stream this
  `Hai` has open. The payload is the one the schema returned, written as JSON,
  so it must survive JSON (see [Surfaces: schemas](surfaces.md#schemas)).
  Nothing checks that it does.
- **It isn't stored or numbered.** The event has no SSE id, so a browser that
  reconnects doesn't ask for the signals it missed.
- **The latest payload of each signal is kept** in this `Hai`'s memory, and
  sent to every stream that opens from then on, just after it opens. So a
  browser that arrives late still has the current value. A newer signal may
  arrive first and then be sent again as the latest, so a browser never ends
  on an older value. Nothing clears the latest value: it stays until the next
  signal of that name replaces it, from `hai.signal` on this or another
  server, and it's lost when the process stops. A payload that can't be
  written as JSON stays the latest too, and every stream that opens later
  then fails with an unhandled rejection, which ends a Node process by
  default.
- **Handlers hear repeats.** Every stream that opens is sent every latest
  value: on each reconnect, and on each poll for a browser that polls (see
  [HTTP routes and the wire](http.md)). The client doesn't remove repeats, so
  the app's handler may be called again with a value it already had. A
  polling browser gets only the latest of each signal sent between two
  polls.
- **It also goes to the other servers**, through the store's `publish`. See
  [Across servers](#across-servers).
- **A slow reader gets only the newest of each.** When a stream's socket is
  backed up, the events route keeps only the latest signal of each name for
  it, and writes those once the socket drains. A stalled browser holds at
  most one of each signal, never every one sent.
- **It never reaches the model.** It isn't in any conversation's history or
  in the transcript. The browser hands it to the app's handler for its name.
  See [The browser client](client.md).

A signal is for values where only the latest matters. Anything a conversation
needs later, or that the model should hear, is a notice.

## Presence

### `hai.onPresence`

```ts
onPresence(listener: (count: number) => void): () => void;
```

Hears how many conversations have an events stream open, on this server and
on the others it hears through the store. `listener` is called with the count
at once, and again whenever it changes. Returns a function that stops
listening.

- **If `listener` throws on that first call,** it isn't kept, and the error is
  thrown from `onPresence`. An error from a later call is ignored, and the
  other listeners still hear the count. Listeners are kept in a set, so the
  same function added twice is kept once, and either stop function removes
  it.
- **It's a count of conversations, not of tabs or people.** Two tabs on one
  conversation count once. The client opens one stream per conversation, so a
  tab with the app open is, as near as the server can tell, one
  conversation. A tab whose conversation hasn't begun has no stream, so it
  isn't counted (see [`HaiConfig.signals`](#haiconfigsignals)).
- **Each server counts its own, and the totals are summed.** A conversation
  counts once per server it has a stream on. One that reconnects to another
  server counts on both until the first server's grace runs out.
- **A stream that closes still counts for `presence.graceMs`,** so a browser
  that reconnects doesn't make the number flicker. A reconnect within the
  grace never drops out of the count at all. A polling browser opens and
  closes a stream with each poll, so it stays counted only because its next
  poll arrives within the grace.
- **An app with no notices, no `updates` and no signals opens no events
  stream,** so its own count stays 0.
- **Only the number leaves a server**: no conversation ids, and nothing the
  model sees.
- **A server that has just started hasn't heard the others yet.** Its count
  leaves theirs out until each sends its next heartbeat, which can take up to
  their `heartbeatMs`. When its own count first goes above 0, the others with
  streams open reply at once. An app that broadcasts the count can wait a
  heartbeat before sending its first.
- **A server that stops keeps counting for a while.** The others drop it once
  they haven't heard from it for three of their own heartbeats, checked when
  they next recount: between three and four heartbeats after it was last
  heard, 30 to 40 seconds by default.
- The total never goes above `Number.MAX_SAFE_INTEGER`, whatever other
  servers claim.

Calling `onPresence`, or opening an events stream, starts the presence
machinery on a server that hasn't started it already. Once started, it runs
for the life of the process: there's no way to stop it.

### `HaiConfig.presence`

```ts
presence?: { graceMs?: number; heartbeatMs?: number };
```

| Option | Default | Meaning |
| --- | --- | --- |
| `graceMs` | `5000` | How long a conversation whose last events stream closed still counts. Keep it well above a poll's round trip, or polling browsers flicker in and out of the count |
| `heartbeatMs` | `10000` | How often a server with streams open, or within their grace, tells the others its count. A server not heard from for three of the receiving server's heartbeats stops counting. Give every server sharing a store the same value: a server that beats slower than three of another's heartbeats drops out of that server's total between beats |

`createHai` throws a `RangeError` unless each is a whole number of
milliseconds from 1 to 2147483647, the longest delay a Node timer keeps:

```
presence.<graceMs|heartbeatMs> must be a whole number of milliseconds, from 1 to 2147483647 (got <value>)
```

## Serving the stream yourself

### `hai.streamOpened`

```ts
streamOpened(conversationId: string, emit: Emit, replay?: Emit): () => void;
```

Tells the server an events stream opened for `conversationId`. The events
route calls it. Call it yourself only if you serve the events stream
yourself, and call the function it returns when the stream closes.

| Parameter | Meaning |
| --- | --- |
| `conversationId` | The conversation the stream belongs to. It counts toward presence while the stream is open. It isn't checked: the events route checks the conversation exists first |
| `emit` | Receives every signal sent from now on, and nothing else. It's called synchronously, from `hai.signal` and from the store's message callback |
| `replay` | Receives each signal's latest payload, once the server is hearing the other servers. Called from a promise callback. Defaults to `emit`. Pass a separate function to tell the replayed values from new ones |

**Behaviour.**

- The latest payloads are sent after the server's subscription to the other
  servers is in place, so one they sent is among them. A new signal may
  arrive through `emit` before them. The latest value is still the latest, so
  at worst one value arrives twice.
- Nothing is replayed once the returned function has been called.
- The returned function does nothing after its first call.

**What a caller must take care of.**

- **`emit` mustn't throw.** An `emit` that throws stops `hai.signal`: the
  remaining streams miss the signal, and it isn't published. Thrown from the
  store's message callback, it can stop the other listeners in the process
  hearing the message. A `replay` that throws is an unhandled rejection.
- **Pass a distinct `emit` per stream.** Streams are kept in a set, so the
  same function passed for two streams is kept once, and the first close
  stops signals for both, while presence still counts the second.
- **Handle a slow socket yourself.** Keeping only the latest of each signal
  while the socket is backed up is the events route's work, not
  `streamOpened`'s.

## Across servers

Signals and presence travel between servers through the store's `publish` and
`subscribe`, on the channel `haikit:signals`. The colon keeps it apart from
any conversation id a store issues. `memoryStore` implements both within one
process. `pgStore` implements them with Postgres `NOTIFY` on its
`haikit_turns` channel, with `haikit:signals` in each message's header, and
has `subscribe` only when given a `listen` connection (see
[Stores](stores.md)). Without `subscribe`, a server hears none of the others;
without `publish`, none hear it.

- **Each server marks what it publishes** with an id of its own, made when the
  `Hai` is created, and ignores its own messages when the store hands them
  back.
- **One publish is in flight at a time.** Behind it waits only the latest of
  each signal, and of this server's count. A burst of signals can't queue
  every outdated payload in the store.
- **Publishing is best effort.** A failed publish is dropped: the other
  servers miss that signal. A failed count is corrected by the next
  heartbeat, except a count that fell to 0, which isn't sent again: the
  others drop it once it goes stale. A store may refuse a message that's too
  long, which the other servers then miss too. `pgStore` refuses messages
  over `MAX_PUBLISH_BYTES` (52,500,000 bytes).
- **A server hears only what's published after it subscribes.** A server that
  has just started has no latest values until the next signal of each name,
  sent from any server. It doesn't ask the others for what they sent before.
- **Anything published on the channel is trusted.** A signal heard from
  another server replaces the latest value here and goes to every stream
  here. It isn't checked against this server's `signals` list, version or
  schema, so during a rolling deploy a server forwards signals it doesn't
  list itself. With `pgStore`, anything that can `NOTIFY` on the database can
  send browsers signals, or fake presence counts.
- **Presence messages carry a count only.** A server publishes its count:
  - when it changes;
  - every `heartbeatMs`, while it has streams open or within their grace;
  - at once, if it has any, when it hears a count above 0 from a server it
    isn't currently counting, so that server hears it too.

  A count of 0 removes the server from the others' totals. A count that isn't
  a safe integer of 0 or more is ignored, and so is a message that isn't one
  of these shapes.
