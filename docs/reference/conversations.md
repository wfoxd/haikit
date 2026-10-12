# Conversations

A conversation is one chat's stored state: the model's history, the surfaces
it has shown, any question it's parked on, and the lease that lets one
request at a time change it. This page covers the stored shapes, how a
request uses the lease, and the two errors stores raise.

Everything on this page is exported by `@haikit/core`. The behaviour
described comes from `@haikit/server` and the two stores.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/runtime.ts`, `packages/server/src/routes.ts`,
`packages/server/src/store.ts` and `packages/postgres/src/index.ts`.

- [`Conversation`](#conversation)
- [`ConversationStatus`](#conversationstatus)
- [`Message`](#message), and [what HaiKIT writes into the history](#what-haikit-writes-into-the-history)
- [`Pending`](#pending)
- [`PayloadRecord`](#payloadrecord)
- [Leases and fencing](#leases-and-fencing)
- [Errors](#errors): `ConversationBusy`, `isConversationBusy`, `StaleLease`,
  `isStaleLease`

## `Conversation`

```ts
interface Conversation {
  id: string;
  status: ConversationStatus;
  messages: Message[];
  handles: string[];
  frozen: string[];
  superseded?: Record<string, string>;
  pending: Pending | null;
  leaseUntil: number | null;
  leaseToken: string | null;
  noticedThrough?: number;
  wakes?: number[];
  wokeThrough?: number;
  wakeTurns?: number;
  announcing?: Omit<NoticeRecord, "seq" | "createdAt"> | null;
}
```

A store returns one from `loadConversation`, along with the lease, and takes
it back in `saveConversation`. Both built-in stores always fill in every
field. A custom store may leave an optional field out, and the meaning of a
missing value is given for each.

| Field | Meaning |
| --- | --- |
| `id` | The conversation's id. The store makes it, and it's unguessable in both built-in stores: `conv_<n>_<16 hex digits>` in `memoryStore`, `conv_<32 hex digits>` in `pgStore`. The routes act on any id they're given, so treat it as a bearer token |
| `status` | `idle`, `streaming` or `awaiting`. See [`ConversationStatus`](#conversationstatus) |
| `messages` | The model's history, in the Messages API's shape. See [`Message`](#message) |
| `handles` | Every surface handle the surviving history rendered, revisions included |
| `frozen` | Handles whose question was answered: by a `resolve` click, by a typed message that closed it out, or withdrawn when its tool failed |
| `superseded` | Revised surfaces: each replaced handle mapped to the handle that replaced it. Missing means none |
| `pending` | The question the conversation is parked on, or `null`. See [`Pending`](#pending) |
| `leaseUntil` | When the lease expires, in epoch milliseconds, or `null` once released |
| `leaseToken` | The fencing token issued with the current lease |
| `noticedThrough` | The highest notice `seq` the history has taken in. Every notice up to it has reached the model, or had nothing for it. Missing means 0 |
| `wakes` | When recent wake turns started, in epoch milliseconds, oldest first. What `maxWakes` counts. Missing means none |
| `wokeThrough` | The highest notice `seq` that can no longer start a wake turn: it started one, or arrived past `maxWakes`. A wake turn that fails before any tool call gives it back. Missing means 0 |
| `wakeTurns` | How many wake turns the conversation has started, failed ones included. Each turn's number lets a server tell an older turn's late events from a newer turn's. Missing means 0 |
| `announcing` | The update notice a `hai.update` revision still owes, saved with the revision. It's cleared once the notice is stored. Missing or `null` means none (see [Revisions](revisions.md#from-outside-a-turn-haiupdate)) |

**Why `handles`, `frozen` and `superseded` live here.** Each of them changes
together with the history, so all of them are on the one row that's written
under the lease. Payload rows never change.

- **`handles`** decides which surfaces can be clicked or revised, and which
  count toward freshness: every handle that isn't superseded, answered ones
  included. A turn that's overtaken has already stored its payloads, but its
  save is rejected, so its handles never join the surviving history. Clicks
  on those payloads are refused (`unknown handle`), and they can't be
  revised. `query_ui` and `hai.notify`'s `handle` option still accept them.
- **`frozen`** commits with the message that records what the user chose.
  Split across two rows, an answered question could be left frozen in one
  and still waiting in the other.

**What a request may leave behind.** At the end of every request that loaded
the conversation, the lease is released and the conversation saved as it
stands, unless the lease was lost (`StaleLease`). That includes a turn that
failed part way: what it recorded before failing is kept. Some steps save
earlier, before the model runs, so a click, the init tool's result, or a wake
turn's opening message stays on record however the turn ends. The exception
is a wake turn that fails before any tool call: it's undone, so its notices
can wake again.

If that closing save fails for any reason other than `StaleLease`, the
browser gets an `error` event, the response ends, and `nodeHandler` logs the
error. The lease stays held, though, so the conversation answers 409 until
the lease expires.

## `ConversationStatus`

```ts
type ConversationStatus = "idle" | "streaming" | "awaiting";
```

| Status | Meaning |
| --- | --- |
| `idle` | No turn is running and no question is waiting |
| `streaming` | A turn is running, or one ended without resetting it (see below) |
| `awaiting` | Parked on a question: `pending` is set |

**A stored `streaming` doesn't mean a turn is running.** The init tool's
commit saves it before the model runs. A typed or clicked turn that fails
with any error other than `StaleLease` is saved with it at the end of the
request, since nothing resets it. Nothing reads a stored `streaming`, and the
next request runs normally: whether a turn is in flight is the lease's job.
Only `awaiting` changes what a request does.

The browser hears most changes as `status` events, but not all: a failed
turn ends with an `error` event and no status, a `resolve` click's return to
`idle` isn't sent until the turn's own statuses, and a failed wake turn's
undo isn't sent.

## `Message`

```ts
interface Message {
  role: "user" | "assistant";
  content: unknown;
}
```

One message of the history, in the Anthropic Messages API's shape. `content`
is a string or a list of content blocks. HaiKIT records the model's assistant
content exactly as the adapter returns it.

### What HaiKIT writes into the history

Besides what the user types and what the model says, HaiKIT writes these into
the history. The bracketed texts mark framework text, not something the user
typed.

| When | What's recorded |
| --- | --- |
| A message the user typed | a user message: its text, after any unread notices' text blocks (see [Notices](notices.md#what-the-model-hears)) |
| A model reply's tool calls finished | one user message holding each call's `tool_result`, in call order: the `ToolReturn`'s `model`, or the framework text for a call that failed (see [Tools](tools.md#how-a-tool-call-runs)). If the reply parked on a question, they're held in `pending.results` instead |
| A `resolve` click | the parked reply's other tool results, then the question's `tool_result`: `<digest>` + newline + `<label>`, then any unread notices |
| An `inform` click | a user message: any unread notices, then `[UI interaction] <label>` |
| A typed message while a question waits | first, a user message closing the question: the parked reply's other tool results, then the question's `tool_result`, `<digest>` + newline + `User did not select; they said: "<text>"`. Then the typed message, as above |
| The init tool | the user's first message, or `[conversation started]` when the client called `start()`, then an assistant message with the init call (id `toolu_init_<16 hex digits>`, input `{}`), then its `tool_result`. If init shows an elicit surface, no result until it's answered: the conversation parks, with no other results held (see [The server](server.md#init)) |
| A notice taken in | a text block `[App notification: <name>] <model text>` |
| An update notice taken in | a text block `[UI update] <model text>` |
| A wake turn | a user message: every unread notice's text block, then `[The user has not said anything. The notifications above arrived on their own.]` |

## `Pending`

```ts
interface Pending {
  toolUseId: string;
  handle: string;
  digest: string;
  results: unknown[];
}
```

The question a parked conversation is waiting on.

| Field | Meaning |
| --- | --- |
| `toolUseId` | The id of the tool call that asked |
| `handle` | The question's surface, at its latest revision. A `resolve` click is accepted on this handle only |
| `digest` | What the model will receive ahead of the answer. An elicit call gets no tool result until it's answered, so the surface's digest hasn't reached the model yet. Anything else the asking call returned follows it. A revision by a later call in the same reply (`ctx.update`) replaces the question's part with the revision's digest. A revision by `hai.update` moves `handle` but leaves `digest` as it was asked, and the update's text follows the answer |
| `results` | The tool results of the other calls in the same model reply. The Messages API needs every result of a reply in one message, so they're held and sent with the answer, or with the typed message that closes the question |

## `PayloadRecord`

```ts
interface PayloadRecord {
  handle: string;
  conversationId: string;
  component: string;
  version: number;
  props: unknown;
  mode: "display" | "elicit";
  createdAt: number;
  staleAfterMs?: number | "never" | null;
}
```

A rendered surface's data. **Immutable once written**: everything about a
surface that changes over the conversation lives on the conversation instead.

| Field | Meaning |
| --- | --- |
| `handle` | The id the store gave it: `ui_` and a number, padded to two digits (`ui_01` … `ui_99`, `ui_100`). A `memoryStore` numbers across all its conversations, so numbers skip within one. `pgStore` numbers within each conversation, and a payload that's never referenced still uses up a number. Unique within its conversation |
| `conversationId` | The conversation it belongs to. Every read is scoped to it: a handle from another conversation never resolves |
| `component` | The surface's name |
| `version` | The surface's version |
| `props` | The validated props, stored as JSON: what comes back is the JSON form of what the schema returned (see [Surfaces: schemas](surfaces.md#schemas)) |
| `mode` | `display` or `elicit`. A revision keeps the mode of the surface it replaces |
| `createdAt` | When the store wrote it, in epoch milliseconds. Freshness counts from it |
| `staleAfterMs` | The surface's freshness window when it rendered, recorded so a later deploy can't relax it. `null` or missing only on payloads written before windows existed, or by a store that doesn't keep it. A store must return exactly what it was given, `"never"` included |

The store stamps `handle` and `createdAt`: `putPayload` takes everything else.

**Orphans.** A payload whose handle never joined the history is an orphan. A
turn that lost its lease leaves its payloads as orphans, and so do an init
tool that fails, a digest that throws, and a revision refused by its final
freshness check. An orphan can't be clicked or revised, but `query_ui` reads
it, and `hai.notify` accepts its handle. `memoryStore` never removes orphans.
With `pgStore`, the app removes them by calling `sweepOrphans` (see
[Stores](stores.md)).

## Leases and fencing

A conversation may have one turn in flight. The lease enforces that, and the
fencing token makes being overtaken safe.

**How a request uses them.**

1. **The route loads the conversation, which takes the lease.** The store
   sets `leaseUntil` to now plus its lease time, and issues a new
   `leaseToken`. If a live lease is already held, the store throws
   `ConversationBusy`, and the route answers HTTP 409 before any stream
   opens.
2. **The request does its work.** Every write that changes the history
   presents the token: storing a payload (`putPayload`), and every save
   (`saveConversation`). A store rejects a token that's no longer the
   conversation's, with `StaleLease`.
3. **At the end, the route sets `leaseUntil` to `null` and saves.** The token
   is kept, so the save can still prove this request holds the lease. The
   lease lasts exactly as long as the request, even when the turn parks on a
   question.

**Expiry.** A lease expires after the store's lease time, 120,000 ms by
default in both built-in stores (`leaseMs`). That's what releases a
conversation whose process crashed, or whose closing save failed. The
runtime never renews a lease. A request that runs longer than the lease time
can be overtaken: another request takes the conversation, with a new token.
The first request only finds out at its next fenced write, which may be its
final save. Until then it keeps running, calling the model and running
tools. Then it fails with `StaleLease` and stops. What it hadn't saved is
discarded, and the newer turn stands. Anything it committed earlier stands
too, its payloads stay as orphans, and its tools' side effects aren't
undone.

**An unknown id starts a new conversation.** In both built-in stores,
`loadConversation` with an id that doesn't exist, or with no id, creates a new
conversation with a new id. A `/chat` request naming an unknown conversation
gets a fresh one, whose id is in the `hello` event, and so does a `/start`
request when there's an init tool. An `/interact` request naming one creates
an empty conversation too, and then refuses the click with `unknown handle`.
No `hello` is sent there, so the browser never learns the new id. `hai.update`
and `hai.wake` check that the conversation exists first, so they never create
one.

**Unfenced writes.** Storing a notice (`putNotice`) takes no token. A notice
comes from outside any turn, so it must land whoever holds the lease, and it
never changes the history.

See [Stores](stores.md) for what a store must guarantee: taking a lease and
checking a token must each be a single atomic operation.

## Errors

### `ConversationBusy`

```ts
class ConversationBusy extends Error {
  readonly name = "ConversationBusy";
  constructor(id: string);
}
```

Thrown by `loadConversation` when another request holds a live lease. The
message is `conversation <id> is busy — another turn is in flight`.

| Who hits it | What happens |
| --- | --- |
| `POST /chat`, `/interact`, and `/start` with an init tool | HTTP 409 with `{ "error": "<message>" }` |
| `hai.update` | Retries until `timeoutMs`, then rejects with it |
| `hai.wake` | Resolves to `"busy"`. The events route retries |

### `isConversationBusy`

```ts
const isConversationBusy: (err: unknown) => boolean;
```

`true` when `err` is an `Error` whose `name` is `"ConversationBusy"`. HaiKIT
checks the name rather than `instanceof ConversationBusy`, so the check still
works when two copies of `@haikit/core` are installed. It still requires
`instanceof Error`, so an error from another realm, or a plain object with
that name, gives `false`. Use it the same way.

### `StaleLease`

```ts
class StaleLease extends Error {
  readonly name = "StaleLease";
  constructor(id: string, detail?: string);
}
```

Thrown by a fenced write (`saveConversation`, `putPayload`) whose token isn't
the conversation's current one: the lease expired, and another request took
the conversation over. A `null` token is rejected the same way. The write is
rejected, and the newer turn stands.

The message is `conversation <id> <detail>`, where `detail` defaults to `was
taken over by a newer turn — this write was discarded`. Both built-in stores
use `does not exist — no lease was ever issued for it` when the conversation
doesn't exist.

| Who hits it | What happens |
| --- | --- |
| A turn during a request | It stops: no more model calls, nothing more saved. The browser gets an `error` event with the message |
| A tool, through `ctx.render` or `ctx.update` | The tool isn't interrupted. Once `run` returns or throws and its renders have settled, the turn stops as above, even if the tool caught the error or never awaited the call |
| `hai.update` | Rejects with it, possibly after the revision and its notice were saved: a newer holder then has them |
| A wake turn | Stops. Every events stream watching the conversation gets an `error` event, then `released`. If the lease was lost only at the final save, the outcome is still `"woke"` |

### `isStaleLease`

```ts
const isStaleLease: (err: unknown) => boolean;
```

`true` when `err` is an `Error` whose `name` is `"StaleLease"`. Checked by
name, like `isConversationBusy`, with the same `instanceof Error`
requirement.
