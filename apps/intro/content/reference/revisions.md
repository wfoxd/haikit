# Revisions

A revision replaces a surface already on screen with new props, in place.
Inside a tool, `ctx.update` makes one. From outside any turn, such as a
webhook, a job or a price feed, `hai.update` does. Either way the revision
is stored as a new payload with a new handle, which *supersedes* the old
one. The browser swaps the new props into the component already showing,
and the model hears the new digest.

Exported by `@haikit/core`: `Update`, `UpdateOptions` (and `ToolCtx.update`,
listed on [Tools](tools.md)). By `@haikit/server`: the `Hai` method `update`,
and the `HaiConfig` option `updates`.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/runtime.ts` and `packages/server/src/routes.ts`.

- [What a revision does](#what-a-revision-does)
- [Inside a tool: `ctx.update`](#inside-a-tool-ctxupdate)
- [From outside a turn: `hai.update`](#from-outside-a-turn-haiupdate):
  `Update`, `UpdateOptions`, `HaiConfig.updates`
- [How the model hears of it](#how-the-model-hears-of-it)
- [How the browser gets it](#how-the-browser-gets-it)

## What a revision does

Both ways of revising do the same to the conversation:

- **A new payload is stored,** with the new props validated against the
  surface's schema. It gets a new handle, the *mode* of the surface it
  replaces, and the freshness window the surface declares now.
- **The new handle joins the history.** The conversation's `superseded` map
  records that the old handle was replaced by the new one.
- **Any click on the old handle is refused**: `superseded by <latest
  handle>`.
- **The old surface's freshness window stops counting.** The revision's
  counts, from when it was stored.
- **A question waiting on the old surface waits on the new one.** The answer
  is still accepted, from the new handle.
- **Which handle to name.** `ctx.update` takes only the latest handle.
  `hai.update` takes any handle the surface has had, and revises the latest.

An answered (frozen) surface can't be revised. Nor can any surface once the
conversation has expired: a revision can't bring an expired conversation back
by superseding the surface that closed it.

## Inside a tool: `ctx.update`

```ts
update<P, A extends ActionMap, Q extends QueryMap>(
  surface: SurfaceImpl<P, A, Q>,
  handle: string,
  props: P,
): Promise<ToolReturn>;
```

Revises a surface this conversation already shows, and resolves to
`{ model: <new digest>, handle: <new handle> }`, the same shape `ctx.render`
resolves to. Return it as the tool's result, so the model hears the new
digest.

**Checks,** in order. The first that fails throws, and nothing is stored:

| Check | Error message |
| --- | --- |
| `handle` is in this conversation's history | `no surface <handle> in this conversation` |
| it isn't frozen: answered, closed out by a typed message, or withdrawn | `<handle> was answered, so it can't be revised` |
| it hasn't been revised already | `<handle> was revised already: it is <latest handle> now` |
| no other call is revising it right now | `<handle> is being revised by another call` |
| its payload can be read | `no surface <handle> in this conversation` |
| its stored surface name is `surface`'s name (versions aren't compared) | `<handle> is a <stored surface name>, not a <surface name>` |
| the conversation hasn't expired | `this conversation is out of date; nothing more can be revised in it` |
| `props` passes the surface's schema | the schema's error |

Then the payload is stored and the digest computed. One last check follows:
the surface being revised must still be within its own window. If it isn't,
the call throws `this conversation went out of date while the revision was
made; it was not applied`. The stored payload is then never referenced.

Then the revision takes effect. The browser gets `ui_open` with
`replaces: <old handle>`, then `ui_props`. A thrown error becomes the tool's
failure, `<tool> failed: <message>`, unless the tool catches it. A lost lease
(`StaleLease`) is the exception: it stops the turn even if the tool catches
it (see [Tools](tools.md#how-a-tool-call-runs)).

**A question this reply asked.** When the revised surface is the question this
model reply is waiting on, the question moves to the new handle. Its answer
goes to the model under the revision's digest, not the original's, followed by
anything else the asking call returned.

`ctx.update` doesn't check that `surface` is registered with `createHai`.
After the tool has returned, it does nothing (see
[Tools](tools.md#toolctx)).

## From outside a turn: `hai.update`

### `hai.update`

```ts
readonly update: Update;

type Update = <P, A extends ActionMap, Q extends QueryMap>(
  conversationId: string,
  surface: SurfaceImpl<P, A, Q>,
  handle: string,
  props: NoInfer<P>,
  options?: UpdateOptions,
) => Promise<{ handle: string }>;
```

Revises a surface from outside any turn, under the conversation's lease. It
stores the revision, then an *update notice*, which tells both sides: the
events stream sends the browser the revision, and the model hears of it with
the next user message, or at once with `wake`. Then it resolves to the
revision's handle. A resolved call means both are stored.

Inside a tool, use `ctx.update` for the tool's own conversation. The running
turn holds the lease, so an awaited `hai.update` on it waits `timeoutMs` and
rejects with `ConversationBusy`. It's a
property holding an arrow function, so it can be passed around without
binding.

| Parameter | Type | Meaning |
| --- | --- | --- |
| `conversationId` | `string` | The conversation |
| `surface` | `SurfaceImpl<P, A, Q>` | The implementation registered in `createHai({ surfaces })` |
| `handle` | `string` | Any handle the surface has had in this conversation. The revision replaces the latest |
| `props` | `P` | Typed from the contract. Validated before anything waits |
| `options` | `UpdateOptions` | See below |

**Refused at once** (the promise rejects before anything waits; an `options`
of `null` throws synchronously instead):

| Check | Error |
| --- | --- |
| `surface` is the implementation registered under its name | `surface "<name>" is not registered: list it in createHai({ surfaces })` |
| `createHai({ updates: true })` was set | `hai.update is off: set createHai({ updates: true })` |
| `timeoutMs` is a finite number of 0 or more | `RangeError`: `timeoutMs must be a finite number of milliseconds, zero or more (got <value>)` |
| `model`, when given, is a string | `TypeError`: `model must be a string` |
| `props` passes the surface's schema | the schema's error |

**Then, for each write:**

1. **The conversation must exist**, or the call rejects with `no
   conversation <conversationId>`.
2. **It takes the lease,** waiting for a turn in progress to finish. While
   another request holds it, the call retries: first after 100 ms, then twice
   as long each time, up to 2,000 ms. Once `timeoutMs` has passed, counted
   from when this write started, it rejects with the store's
   `ConversationBusy`: `conversation <id> is busy — another turn is in
   flight`. With `timeoutMs: 0` it tries once.
3. **Any update notice the conversation still owes is stored first.**
4. **The surface is checked**, at its latest revision:

   | Check | Error |
   | --- | --- |
   | `handle` is in the conversation's history | `no surface <handle> in conversation <conversationId>` |
   | its latest revision isn't frozen | `<latest> was answered, so it can't be revised` |
   | its payload can be read | `no surface <latest> in conversation <conversationId>` |
   | its stored surface name is `surface`'s name | `<latest> is a <stored surface name>, not a <surface name>` |
   | the conversation hasn't expired | `this conversation is out of date; nothing more can be revised in it` |

5. **The revision is stored and its digest computed.** The surface being
   revised must still be within its own window, or the call rejects with
   `this conversation went out of date while the revision was made; it was
   not applied`.
6. **It takes effect.** The history records the revision, and a question
   waiting on the surface moves to the new handle. It keeps the digest it
   was asked under, which goes to the model with the answer. The update notice is recorded as owed, and the
   conversation is saved with it, so the two can't come apart.
7. **The update notice is stored.** If that fails, the call rejects with
   `<new handle> is saved, but its update notice could not be stored yet: it
   goes out with the conversation's next request (<message>)`. The revision
   stands, and the notice stays owed (see below).
8. **The lease is released,** and the conversation saved. That happens after
   a refusal in steps 3 to 5 too, and the refusal's error is the one the call
   rejects with. If the lease was lost (`StaleLease`), the call rejects with
   it, and nothing more is saved. If this last save fails after steps 6 and 7
   succeeded, the call rejects even though the revision and its notice are
   both stored. A caller that retries then makes a second revision.

**One write per surface is in flight at a time.** Calls for the same surface
in the same conversation queue behind the one writing:

- A call made while one is writing replaces any call still waiting. Its
  props, `model` and `timeoutMs` win.
- Every call it replaced resolves with it, to the handle it writes, or
  rejects with its error.
- A `wake` any of them asked for still wakes.

Calls share a queue when they name the same handle, or two handles the server
links: the handle the first `hai.update` call for the surface named, and the
latest revision `hai.update` wrote. It remembers those for the 10,000
conversations most recently revised. A call naming any other handle gets a
queue of its own: a handle `ctx.update` made since, a handle from before the
first call's, or one it has forgotten. That costs coalescing but never
correctness, since every write revises the latest.

The queue is in the memory of one `Hai`. Servers sharing a store don't
coalesce: their calls take turns on the lease, and each one writes.

**A queued call is written as the call that started the queue.** The queue
is keyed by conversation and handle, not by surface, and every write in it
uses the surface and handle of the call that started it. A queued call
passing a different surface for the same handle has its props checked
against its own surface's schema, but stored and digested as the first
call's surface, and the surface name check doesn't catch it.

**The owed notice.** The revision and its update notice can't be written in
one step, because the notice is stored outside the conversation's row. So
the notice is recorded on the conversation, in `announcing`, and saved with
the revision. Whoever next holds the conversation stores it before doing
anything else, if it isn't stored already: the next `/chat` or `/interact`
request, the next wake turn, or the next `hai.update`. So the model always
hears of a revision before it runs again.

### `UpdateOptions`

```ts
interface UpdateOptions {
  model?: string;
  wake?: boolean;
  timeoutMs?: number;
}
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `model` | `string` | none | A sentence for the model about why the surface changed, such as `Fares moved: AC832 is now $389 (was $343).`. It goes before what the model always hears (see [How the model hears of it](#how-the-model-hears-of-it)). An empty string adds nothing |
| `wake` | `boolean` | `false` | Only `true` counts: any other value is treated as `false`, without an error. Start a turn so the model can tell the user. Under the same rules as a `wake` notice: `maxWakes`, no turn while a question waits, and only while a browser has the events stream open (see [Notices: wake turns](notices.md#wake-turns)) |
| `timeoutMs` | `number` | `30000` | How long to wait for a turn in progress to let the conversation go, before rejecting with `ConversationBusy` |

### `HaiConfig.updates`

```ts
updates?: boolean;   // default: off
```

Set it to `true` to use `hai.update`, which refuses without it. It also:

- makes the browser open the events stream for every conversation, since
  that's how a revision reaches it;
- has the events route start the turns an update sent with `wake` asks for;
- makes the conversation's unread notices part of every request, as
  registering a notice does.

`ctx.update` works without it.

## How the model hears of it

**From `ctx.update`,** as the tool result: the new digest, or whatever the tool
returns.

**From `hai.update`,** as an update notice's model text, in the next user
message the conversation records (or the wake turn's):

```
[UI update] <model, then a space, when given><old handle> was replaced by <new handle>; its earlier digest is out of date. Now: <new digest>
```

`<old handle>` is the surface's latest handle before this write, which isn't
necessarily the one the caller passed.

For example, with `model` set:

```
[UI update] Fares moved: AC832 is now $389 (was $343). ui_03 was replaced by ui_07; its earlier digest is out of date. Now: 12 flights, cheapest AC832 $389 …
```

When the user clicks to answer a question that was revised from outside the
turn, the update's text rides in the same message as the answer, after it,
saying what changed since the question was asked. When the user types
instead, the question is closed out in a message of its own, and the
update's text goes in the next message, ahead of the typed text.

**A query on an old handle** answers from the old props, and adds `(<old
handle> has since been revised: it is <latest handle> now.)` (see
[Surfaces: query handlers](surfaces.md#query-handlers)).

## How the browser gets it

**From `ctx.update`,** during the turn, on the stream that carries it: the
response to the request, or the events stream for a wake turn. It's
`ui_open` with `replaces`, then `ui_props`.

**From `hai.update`,** on the events stream, as the update notice it stored.
The stream sends it as two frames:

```
data: {"type":"ui_open","handle":"ui_07","toolId":"","component":"flight_results","version":1,"mode":"display","staleAfterMs":600000,"ageMs":42,"replaces":"ui_03"}

id: 12
data: {"type":"ui_props","handle":"ui_07","props":{…}}
```

- `toolId` is empty, because no tool call made the revision. The browser
  keeps the row of the call that made the surface.
- `ageMs` is how long ago the revision was stored. The browser counts the
  freshness window from it.
- `staleAfterMs` is present when the revision's recorded window is a number.
- Only the second frame carries the notice's id, so a stream cut off between
  the two resumes with both.
- If the revision's payload is gone, removed with an old conversation's data,
  the stream sends the id alone, so the browser resumes after it.

A browser that receives `ui_open` with `replaces` moves the surface to the new
handle in place. It calls the component's `update(props)` if it has one, and
mounts the component again in the same element if not. See
[The browser client](client.md) for that, and for `alsoReplaces`. A revision
replayed to a stream that joins a wake turn part way, or to a poll after a
wake turn that ended between two polls, can carry `alsoReplaces`.
