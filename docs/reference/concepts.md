# Concepts

The terms the rest of this manual uses, each defined once. Every definition
links to the page with the full detail.

Checked against `@haikit/*` 0.20.0.

## The two channels

**Dual channel.** A tool that shows a surface produces two things from the
same props: a *payload*, which is stored and sent to the browser, and a
*digest*, which goes to the model as the tool result. The model never receives
a payload. To learn more about one, it calls a *query* through the built-in
`query_ui` tool, whose answer is *capped*. See [Surfaces](surfaces.md).

**Payload.** A rendered surface's props, validated against the contract's
schema and stored as a `PayloadRecord`. The record holds the handle, the
contract's name and version, the mode, when it was stored, and its freshness
window. It never changes once written, and it reaches the browser as a
`ui_props` event. See [Conversations](conversations.md).

**Digest.** The string a surface implementation's `digest(props, { handle })`
returns. Until the model queries the surface, the digest is everything it
knows about it. Every surface implementation must have one. See
[Surfaces](surfaces.md).

**Model text.** A notice's equivalent of a digest: what the notice
implementation's `model(payload)` returns, or `null` for nothing. It's
computed once, when the notice is sent, and stored with it. See
[Notices](notices.md).

## Surfaces

**Surface.** A component a tool shows in the conversation. It has two halves:

- **The contract,** declared once with `defineSurface`: its name, version,
  props schema, actions and queries. Both the server and the browser import
  it.
- **The implementation,** made on the server with `.implement()`: the digest,
  one handler per action and per query, and the freshness window.

In the browser, the component registered under the contract's name renders
the surface. See [Surfaces](surfaces.md).

**Handle.** The id the store gives a surface's payload when it's stored, such
as `ui_01`. `memoryStore` numbers handles across the whole process, and
`pgStore` within each conversation, so a handle is only unique within a
conversation. Each interaction names one. A handle in the conversation's
`handles` list is part of its history. A payload whose handle isn't in that
list is inert: a turn that was overtaken leaves one behind, and every click on
it is refused. See [Conversations](conversations.md).

**Mode.** How a surface is rendered: `display` or `elicit`.

- A **display** surface is shown, and the tool call finishes straight away,
  with the digest as its result.
- An **elicit** surface is a question. The turn parks on it until the user
  answers with a `resolve` action, or types a message instead.

The types only accept `elicit` for a surface that declares a `resolve`
action. See [Surfaces](surfaces.md).

**Action.** A declared interaction that reaches the server: the browser posts
`{ handle, action, value }` to `/interact`. The server validates `value`
against the action's schema, runs its handler, and records the string the
handler returns, the *label*. An interaction the contract doesn't declare has
no way to reach the server. There are two kinds:

- **`resolve`** answers the question the turn is parked on. The label follows
  the surface's digest as the tool result, the surface is frozen, and the
  turn carries on.
- **`inform`** records `[UI interaction] <label>` as a user message and runs a
  turn. It's refused while a question is waiting.

See [Surfaces](surfaces.md).

**Query.** A named, read-only way into a stored payload, declared in the
contract with `query(...)`. The model calls it through `query_ui`. Its
handler can only return a value made by `ctx.cap`. See [Surfaces](surfaces.md)
and [Tools](tools.md).

**Cap.** What bounds a query's answer. It keeps at most `maxRows` rows
(default 8) within `maxChars` characters (default 1800), and its first line
says how many rows matched, how many are shown and how many were left out.
See [Tools](tools.md).

**Frozen.** An elicit surface that's finished with. That happens in three
ways: a `resolve` click answered it, the user typed a message instead, or the
tool that showed it failed and withdrew it. Any click on a frozen surface is
refused. Frozen handles are listed in `Conversation.frozen`. See
[Conversations](conversations.md).

**Revision.** A new version of a surface already on screen, made by
`ctx.update` inside a tool or by `hai.update` from app code. It's stored as a
new payload with a new handle, which *supersedes* the old one:

- The browser swaps the new props into the component already showing.
- Any click on the old handle is refused.
- The old surface's freshness window stops counting.
- A question waiting on the old surface waits on the new one.

See [Revisions](revisions.md).

**Freshness window.** A surface implementation's `staleAfterMs`: how long its
data may be acted on, counted from when its payload was stored. The default is
`"never"`. Once any surface in a conversation is past its window, the
conversation has *expired*, and every further request is refused before the
model runs. Answered surfaces count toward this; superseded ones don't. Each
payload records the window it was shown under, and a surface is held to the
stricter of that and the one the code declares now. See
[Surfaces](surfaces.md).

## Turns

**Turn.** What one request runs on a conversation. It starts by recording
something new: a typed message, a click, or unread notices on a wake turn. It
runs the model until a reply asks for no more tools, the turn parks on a
question, or it reaches `maxHops`. See [The server](server.md).

**Hop.** One model call, plus the tool calls in its reply. A turn runs at most
`maxHops` of them, 8 by default. See [The server](server.md).

**Tool.** A function the model can call, declared with `defineTool`: its name,
its description, its input schema and the JSON Schema the model sees. Its
`run` returns a `ToolReturn`, whose `model` text becomes the tool result. See
[Tools](tools.md).

**Parked turn.** A turn waiting on an elicit surface. The conversation's
status is `awaiting`, and `pending` records the tool call, the handle, the
digest and any results from other tool calls in the same reply. The request
ends there, while the conversation stays parked in the store until a
`resolve` click or a typed message. A model reply asks one question at most:
a second elicit render in the same reply isn't shown, and the tool hears why.
See [Tools](tools.md) and [Conversations](conversations.md).

**Init tool.** `HaiConfig.init`: a tool the runtime calls itself, with `{}`,
at the start of every conversation, before the model's first turn. It's
recorded as if the model had called it. See [The server](server.md).

**Wake turn.** A turn nobody started by typing. The events route runs one for
`wake` notices the conversation hasn't heard yet, or for a `hai.update` sent
with `wake: true`, and only while a browser has the events stream open.
`maxWakes` limits how often, 1 every 60,000 ms by default. See
[Notices](notices.md).

## Conversations

**Conversation.** One chat's stored state: its id, status and messages (the
model's history), its handles and which are frozen or superseded, any
question it's parked on, its lease, and its record of notices taken in and
wake turns run. The routes act on whatever conversation id they're given, so
treat an id as a bearer token. See [Conversations](conversations.md).

**Status.** A conversation's state: `idle` (nothing running), `streaming` (a
turn is running) or `awaiting` (parked on a question). See
[Conversations](conversations.md).

**Lease.** The exclusive right to run a turn on a conversation. Loading the
conversation takes it, and it's held for the whole request. It also expires
after the store's lease time (120,000 ms by default, in both `memoryStore`
and `pgStore`), so a conversation whose process crashed is released. A
request that arrives while the lease is held is refused with HTTP 409. See
[Conversations](conversations.md) and [Stores](stores.md).

**Fencing token.** A new token issued each time a lease is taken. Every write
that changes a conversation's history presents it: saving the conversation,
and storing a payload. A request whose lease expired, and whose conversation
another request then took over, holds an old token. Its writes fail with
`StaleLease` and are discarded. See [Conversations](conversations.md).

**Expired.** A conversation past one of its surfaces' freshness windows. Every
request on it is answered with an `expired` event, and nothing is recorded.
See [Surfaces](surfaces.md) and [HTTP routes and the wire](http.md).

## After the request

**Events stream.** `GET {base}/events?conversationId=…`, a long-lived
server-sent events stream. The browser opens one per conversation when the
app sends notices, revisions or signals. It carries notices, revisions,
signals and wake turns, and on reconnecting it resumes after the last notice
the browser saw. Behind a proxy that holds streams back, the browser polls the
same route instead. See [HTTP routes and the wire](http.md) and
[The browser client](client.md).

**Notice.** Something the server tells a conversation outside any request,
with `hai.notify`. Its payload goes to the browser over the events stream,
and its model text goes to the model with the next user message the
conversation records. Notices are stored, never change, and are numbered
(`seq`) within their conversation. A **passive** notice (the default) waits
for the user, and a **wake** notice starts a wake turn. See
[Notices](notices.md).

**Update notice.** The notice `hai.update` stores for a revision. The events
stream sends it as the revision's `ui_open` and `ui_props` events, and the
model hears it as `[UI update] …`. See [Revisions](revisions.md).

**Signal.** A broadcast to every open events stream, on every server sharing
the store, sent with `hai.signal`. A signal isn't stored, belongs to no
conversation, and never reaches the model or the transcript. Each signal's
latest payload is sent to a stream when it opens. See
[Signals and presence](signals.md).

**Presence.** How many conversations have an events stream open, across every
server sharing the store, heard with `hai.onPresence`. A conversation whose
stream closed still counts for `presence.graceMs`, 5,000 ms by default. See
[Signals and presence](signals.md).

## Infrastructure

**Store.** An implementation of `StoreAdapter`. It keeps conversations, with
their leases and fencing, plus payloads and notices. It may also implement
`watch`, `publish` and `subscribe`, which let several servers work together.
HaiKIT ships two: `memoryStore`, for development in one process, and
`pgStore`, for Postgres. See [Stores](stores.md).

**Model adapter.** An implementation of `ModelAdapter`: an `id`, and a
`generate` method shaped like the Anthropic Messages API. `@haikit/anthropic`
provides one for Claude. See [Models](models.md).

**Wire event.** One JSON object in a server-sent events `data:` frame, of one
of the 15 `WireEvent` types. Both the POST routes and the events stream send
them. See [HTTP routes and the wire](http.md).

**Block.** One entry in the transcript the browser keeps. The server sends
`user`, `assistant`, `tool` and `interaction` blocks. The client adds `ui`,
`notice`, `error` and `expired` blocks of its own, made from other events.
See [The browser client](client.md).

## The four guarantees

`@haikit/core`'s types refuse to compile four mistakes:

1. **A surface without a digest.** `digest` is required, and so is `model` on
   a notice.
2. **A query answer that isn't capped.** A query handler must return a
   `Capped`, and `ctx.cap` is the only way to make one.
3. **A question that can't be answered.** `mode: "elicit"` only accepts a
   surface that declares a `resolve` action.
4. **A round trip that wasn't declared.** An action in the contract is the
   only way a click reaches the server.

The server also enforces the fourth at runtime: an action the surface doesn't
declare and implement is refused. The other three are enforced only by the
types. JavaScript code, which the type checker doesn't see, can get past them.
[Surfaces](surfaces.md) says what happens then.
