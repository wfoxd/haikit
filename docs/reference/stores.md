# Stores

A store keeps conversations, payloads and notices. Every store implements
`StoreAdapter`, the interface `@haikit/core` declares. HaiKIT ships two:
`memoryStore`, for development in one process, and `pgStore` from
`@haikit/postgres`, for production and for running several servers. Who
owns which conversation is kept by `@haikit/auth`'s own store, beside it
(see [Sign-in and ownership](auth.md#stores)).

Exported by `@haikit/core`: `StoreAdapter`. By `@haikit/server`:
`memoryStore`. By `@haikit/postgres`: `pgStore`, `PgStoreOptions`,
`Queryable`, `Listener`, `migrate`, `schema`, `sweepOrphans`,
`SweepOptions`, `NOTICE_CHANNEL`, `TURN_CHANNEL`, `MAX_PUBLISH_BYTES`.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts`,
`packages/server/src/store.ts` and `packages/postgres/src/index.ts`.

- [The contract: `StoreAdapter`](#the-contract-storeadapter)
- [`memoryStore`](#memorystore)
- [`pgStore`](#pgstore): `pgStore`, `PgStoreOptions`, `Queryable`,
  `Listener`
- [The schema](#the-schema): `migrate`, `schema`
- [Across servers with Postgres](#across-servers-with-postgres):
  `NOTICE_CHANNEL`, `TURN_CHANNEL`, `MAX_PUBLISH_BYTES`
- [Cleaning up](#cleaning-up): `sweepOrphans`, `SweepOptions`

## The contract: `StoreAdapter`

```ts
interface StoreAdapter {
  loadConversation(id: string | undefined): Promise<Conversation>;
  saveConversation(conversation: Conversation): Promise<void>;
  putPayload(record: Omit<PayloadRecord, "handle" | "createdAt">, leaseToken: string | null): Promise<string>;
  getPayload(handle: string, conversationId: string): Promise<PayloadRecord | null>;
  getPayloads(handles: string[], conversationId: string): Promise<PayloadRecord[]>;
  putNotice(record: Omit<NoticeRecord, "seq" | "createdAt">): Promise<NoticeRecord>;
  getNotices(conversationId: string, after: number, limit?: number): Promise<NoticeRecord[] | null>;
  watch?(conversationId: string, signal: AbortSignal): AsyncIterable<void>;
  publish?(conversationId: string, message: string): Promise<void>;
  subscribe?(conversationId: string, onMessage: (message: string) => void, signal: AbortSignal): Promise<void>;
}
```

The rules below are what a store must do for the runtime to be correct. The
atomicity rules can't be tested against an in-process store or a single
connection: two acquisitions can't be interleaved there, so a store that
reads and then writes passes every such test and still races in production.
Review them, or race real connections against a real database.

**What every store must also do:**

- **Share no object with the caller.** `loadConversation` hands back a copy,
  and `saveConversation` keeps a copy. A store that keeps the caller's object
  rewrites the old holder's token when it issues a new one, and fencing is
  gone.
- **Save every field,** `leaseUntil` included: the runtime releases a lease
  only by setting `leaseUntil` to `null` and saving. A store that ignores it
  answers `ConversationBusy` for the lease time after every request. The
  optional fields (`announcing`, `wokeThrough`, `wakeTurns`, …) must come
  back as saved.
- **Keep the handle and notice counters out of what a save writes,** so a
  save can't rewind them.
- **Start a new conversation empty:** status `idle`, no messages, handles or
  frozen handles, `pending` `null`. The runtime treats no messages as "not
  begun".
- **Never lose a payload the history refers to, and return `createdAt` as a
  finite number of epoch milliseconds.** Either failure closes the
  conversation for good, as out of date.
- **Number notices from 1,** as positive safe integers: reads ask for
  `seq > after` starting from 0, and the runtime may pass `after` up to
  `Number.MAX_SAFE_INTEGER`.
- **Accept any id.** `loadConversation` gets the browser's `conversationId`
  unchecked: any JSON value. Treat one that isn't a string, or isn't known,
  as a new conversation, rather than throwing.
- **Store any string.** Messages, props and payloads hold whatever users
  type and tools return. A string the store's database can't hold must be
  stored changed, not refused: a refused closing save leaves the conversation
  held until its lease expires. Both built-in stores replace U+0000 and lone
  surrogates with U+FFFD.
- **Issue ids without a colon,** so none can be the signals channel,
  `haikit:signals`.

### `loadConversation`

Loads a conversation, creating one when `id` is `undefined`, and **takes its
lease**: sets `leaseUntil` to now plus the lease time, and issues a new
`leaseToken`.

- **Throws `ConversationBusy`** while another holder's lease is live. A lease
  past its time is expired and may be taken: that releases a conversation
  stranded by a crashed process.
- **Checks the lease here,** not at save time. A conflict found after the
  turn has run has already cost a model call.
- **Takes it atomically,** in one conditional statement, never a read
  followed by a write. Otherwise two servers can both read "expired" and both
  acquire:

  ```sql
  UPDATE conversations
     SET lease_until = now() + $ttl, lease_token = gen_random_uuid()
   WHERE id = $1 AND (lease_until IS NULL OR lease_until < now())
   RETURNING *
  ```

  No row returned means the lease was live.

Both built-in stores also create a new conversation, with a new id, when
`id` names one that doesn't exist. The runtime relies on that only for
`/chat`, `/start` and `/interact`; `hai.update` and `hai.wake` check that a
conversation exists before loading it.

### `saveConversation`

Saves a conversation, **rejecting a holder that has been superseded**.

- **Throws `StaleLease`** when `conversation.leaseToken` isn't the stored
  token. Without that check, a request slower than the lease time is
  overtaken, and its final write overwrites the turn that overtook it.
- **Compares and writes in one statement,** treating no matched row as stale:

  ```sql
  UPDATE conversations SET messages = $3, ...
   WHERE id = $1 AND lease_token = $2
  -- no row → throw StaleLease
  ```

- **Rejects a conversation that doesn't exist, and a `null` token,** both of
  which that statement rejects by itself. Saving isn't an upsert: every
  conversation begins at `loadConversation`.
- **Keeps a copy, not the caller's object** (see above). A store that shares
  one can't detect staleness at all, because the caller's copy and the
  stored one are the same object.

### `putPayload`

Stores a payload and returns its handle. The store makes the handle, unique
within the conversation, and stamps `createdAt`.

- **Fenced:** throws `StaleLease` unless `leaseToken` is the conversation's
  current token. A superseded turn must stop writing, not run to the end and
  be discarded. Check and insert in one statement:

  ```sql
  INSERT INTO payloads (conversation_id, handle, ...)
  SELECT $1, $2, ... WHERE EXISTS (
    SELECT 1 FROM conversations WHERE id = $1 AND lease_token = $3)
  -- no row → throw StaleLease
  ```

  That rejects an unknown conversation and a `null` token too, as a store
  must: otherwise a caller with no lease can create rows no conversation owns.
- **What it stores comes back from `getPayload` exactly as given,**
  `staleAfterMs` included, as a number or the string `"never"`. It's what
  holds data to the window it was shown under after a deploy changes the
  surface. Both built-in stores return a missing `staleAfterMs` as `null`.
- A row written before the lease was lost outlives its turn. The history
  never refers to it, so it's inert (see
  [Conversations: orphans](conversations.md#payloadrecord)). A durable store
  should record the writer's lease token with each payload, so such a row can
  be removed once the conversation's token has changed, as `sweepOrphans`
  does. Its age only gives a grace period.

### `getPayload`, `getPayloads`

`getPayload` returns the payload with that handle in that conversation, or
`null`. It's scoped: a handle from another conversation never resolves.

`getPayloads` is exactly `getPayload` once per input handle, in input order,
with the `null`s dropped. A missing or out-of-scope handle is left out, so the
result may be shorter than the input. A handle listed twice appears twice. A
store must not remove duplicates: callers count on this definition. It exists
because the runtime reads every payload of the history on every turn, for
freshness and for the `context` event's token estimate: one round trip
instead of one per handle.

### `putNotice`

Appends a notice and returns it as stored, with `seq` and `createdAt`.

- **Unfenced:** it takes no token. A notice comes from outside any turn and
  must land while a turn is streaming or parked. It never touches the
  conversation's history.
- **Throws** if the conversation doesn't exist.
- **Returns every field exactly as given.**
- **`seq` is per conversation, and in commit order,** not merely increasing.
  With a global sequence, one write can take 10 and commit after another
  commits 11, and a reader at 11 never sees 10. Number it under the
  conversation's row lock, in the same statement as the insert:

  ```sql
  WITH next AS (
    UPDATE conversations SET notice_seq = notice_seq + 1
     WHERE id = $1 RETURNING notice_seq)
  INSERT INTO notices (conversation_id, seq, …)
  SELECT $1, notice_seq, … FROM next RETURNING *
  ```

  No row from `next` means no such conversation. Gaps in `seq` are allowed.

### `getNotices`

Returns the conversation's notices with `seq > after`, in `seq` order, at most
`limit` of them (all, when left out). `null` means there's no such
conversation; `[]` means none after `after`. The runtime uses `null` as its
cheapest check that a conversation exists.

### `watch` (optional)

Yields each time a notice may have landed in the conversation, until `signal`
aborts. It carries nothing: the caller reads with `getNotices`, so a lost or
spurious wake-up delays a notice but never loses or repeats one. The events
route reads every 2,000 ms regardless, when the app has notices or
`updates`; `watch` only makes a read sooner.

### `publish`, `subscribe` (optional)

Carry a message to every process listening for a conversation, so a wake turn
running in one process reaches browsers connected to the others, and signals
and presence reach every server. Without them, a wake turn reaches only the
events streams of the process that runs it, and signals and presence stay on
each server.

- **`publish`** delivers `message` to every subscriber of the conversation, in
  every process, this one included, in the order this process published
  them, and whole. A store may have a maximum length. It must reject a longer
  message, not drop it. Otherwise it's best effort: a subscriber that wasn't
  listening at the time doesn't get the message later. The runtime treats the
  message as opaque text.
- **`subscribe`** hears what's published for a conversation, until `signal`
  aborts. It resolves once it's listening: anything published after that
  reaches `onMessage`. A store that can't start listening still resolves,
  and hears nothing.

The runtime publishes for conversation ids, and for the signals channel
`haikit:signals` (see [Signals and presence](signals.md#across-servers)).

## `memoryStore`

```ts
function memoryStore(options?: { leaseMs?: number }): StoreAdapter;
```

(Its options type, `MemoryStoreOptions`, isn't exported.)

A store in the process's memory, for development and tests. It enforces the
same rules a durable store must: scoping, leasing and fencing.

| Option | Default | Meaning |
| --- | --- | --- |
| `leaseMs` | `120000` | The lease time. A request that ends without its closing save holds the conversation this long; too short, and a slow turn is overtaken while still running. The runtime never renews a lease |

It throws a `RangeError` unless `leaseMs` is a positive, finite number:
`leaseMs must be a positive, finite number of milliseconds (got <value>)`.

**Behaviour.**

- **Everything is lost when the process stops,** and nothing is ever removed
  while it runs: every page view that starts a conversation keeps it, with
  its payloads and notices, for the life of the process. A parked question is
  durable state, so use a durable store in production.
- **It copies through JSON,** in and out: `JSON.parse(JSON.stringify(…))`. A
  caller never holds a live reference to stored state, and anything a real
  store's `jsonb` column would drop or change (`undefined`, a `Date`'s type, a
  class instance) is dropped or changed here too, in development. So are
  strings Postgres can't store: U+0000 and lone surrogates become U+FFFD, as
  `pgStore` stores them.
- **Ids:** `conv_<n>_<16 hex digits>`, unguessable. Handles are `ui_01`,
  `ui_02`, … numbered across all of this store's conversations, padded to two
  digits.
- **Time:** leases and `createdAt` use the process's clock (`Date.now()`).
- **Lease check:** a lease is live while `leaseUntil` is later than now.
- **`putNotice`** throws `conversation <id> does not exist` for an unknown
  conversation.
- **`watch`** wakes as soon as a notice is stored in this store.
- **`publish` and `subscribe`** work within the process: what one `Hai`
  publishes, every `Hai` sharing this store hears, synchronously and in
  order. Nothing crosses to another process.
- **Nothing sweeps orphaned payloads.**

## `pgStore`

```ts
function pgStore(db: Queryable, options?: PgStoreOptions): StoreAdapter;
```

A durable store on Postgres. Every write, and every lease acquisition, is
one SQL statement, with the token check inside it. When one matches nothing,
a second read only picks which error to throw (or, for an unknown id,
inserts a new conversation). `getNotices` reads again when it finds nothing,
to tell `[]` from `null`. Lease times come from the database's clock
(`now()`), so clock skew between app servers can't hand a conversation to two
of them.

```ts
import pg from "pg";
import { createHai } from "@haikit/server";
import { pgStore, migrate } from "@haikit/postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);

const hai = createHai({ store: pgStore(pool), model, tools, surfaces, system });
```

Call `migrate` (or apply `schema`) before the store is used.

It throws a `RangeError` unless `leaseMs` is a positive, finite number, with
the same message as `memoryStore`.

**Behaviour.**

- **Ids:** `conv_<32 hex digits>`, unguessable. Handles are `ui_01`, `ui_02`,
  … numbered within each conversation, padded to two digits. A payload that
  never joins the history still uses up a number.
- **Lease check:** a lease is live while `lease_until` is later than the
  database's `now()`.
- **JSON:** messages, props, payloads and the like are stored as `jsonb`, and
  read back as text and parsed. So what comes back is the JSON form of what
  was stored, and an object's keys come back in `jsonb`'s order, shorter keys
  first, not the order they were written in.
- **`staleAfterMs`** is stored as a number of milliseconds, `"never"` as
  `Infinity`, and comes back as given.
- **Time:** `createdAt` comes from the database's clock, but the runtime
  measures freshness and ages with the app server's clock, so skew between
  the two shifts when surfaces go out of date.
- **Strings Postgres refuses** are stored changed. Postgres refuses U+0000
  in any text or `jsonb`, and a lone surrogate in `jsonb`. `pgStore` replaces
  each with U+FFFD as it writes: in every string and object key of what it
  stores as `jsonb` (messages, props, payloads), and in every text parameter,
  such as a notice's model text, or an id from the browser (which then
  matches no conversation). A valid surrogate pair is left alone.
- **Integer columns:** a surface's or notice's `version` must be a whole
  number in 32-bit range, or the write fails. The per-conversation counters
  `handle_seq`, `notice_seq` and `wake_turns` are 32-bit too, so a
  conversation's next payload, notice or wake turn fails once its counter
  reaches 2,147,483,647.
- **`putNotice`** also sends a `NOTIFY` on `haikit_notices`, with the
  conversation id, in the same statement. It throws `conversation <id> does
  not exist` for an unknown conversation.
- **`getPayloads`** returns a separate copy for each occurrence of a handle.
- **`publish`** is always there. **`watch` and `subscribe`** exist only when
  `options.listen` is given. Without it, the events route finds new notices
  on its 2,000 ms reads, and this server hears no other server's wake turns,
  signals or presence, though they hear its own.
- **Nothing is removed automatically.** Orphaned payloads stay until
  `sweepOrphans` removes them, and conversations stay until you delete them.
  Deleting a conversation deletes its payloads and notices.

### `PgStoreOptions`

```ts
interface PgStoreOptions {
  leaseMs?: number;
  listen?: Listener;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `leaseMs` | `120000` | The lease time, as for `memoryStore` |
| `listen` | none | A connection that can `LISTEN`. With it, the events route hears of a notice the moment it lands, and servers hear each other's wake turns, signals and presence. It needs a connection of its own: a pooled one goes back to the pool and stops listening |

### `Queryable`

```ts
interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
```

Anything that runs a parameterised statement and returns rows: a `pg.Pool`, a
`pg.Client` and PGlite all fit as they are. The driver, pooling, TLS and the
connection's lifecycle are the app's. Only `rows` is used: every fenced
statement uses `RETURNING`, so a driver's affected-row count isn't needed.

### `Listener`

```ts
interface Listener {
  listen(channel: string, onNotify: (payload: string) => void): Promise<unknown>;
}
```

Something that can `LISTEN` on a channel and report each `NOTIFY` payload.
`listen` resolves once listening; what it resolves to isn't used. The store
calls it once per channel, `haikit_notices` and `haikit_turns`, when first
needed, and calls it again later if it failed. PGlite fits as it is
(`pgStore(db, { listen: db })`). With `pg`, use a client of its own:

```ts
const listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
await listener.connect();

const store = pgStore(pool, {
  listen: {
    async listen(channel, onNotify) {
      listener.on("notification", (msg) => msg.channel === channel && onNotify(msg.payload ?? ""));
      await listener.query(`LISTEN ${channel}`);
    },
  },
});
```

Once `listen` has succeeded for a channel, the store never calls it again.
If the listening connection drops, reconnecting it isn't enough: the app must
issue `LISTEN` on both channels again itself, and keep routing notifications
to the callbacks the store passed first. Until then, notices are still read
every 2,000 ms, but other servers' wake turns, signals and presence are
missed. A `listen` that fails is tried again only when the next `watch` or
`subscribe` needs its channel. Meanwhile a `subscribe` hears nothing, and a
`watch` ends, leaving its stream to the 2,000 ms reads.

## The schema

### `migrate`

```ts
function migrate(db: Queryable): Promise<void>;
```

Creates the tables if they don't exist, and brings existing ones up to date,
by running each statement of `schema` in turn, one per call. It's idempotent:
run it at every startup. It takes no lock and runs no transaction, so on a
fresh database, run it from one server first: several creating the tables at
once can collide.

### `schema`

```ts
const schema: readonly string[];
```

The statements `migrate` runs, for an app that uses its own migration tool.
Three tables:

| Table | Holds | Key |
| --- | --- | --- |
| `haikit_conversations` | One row per conversation: every `Conversation` field, the counters `handle_seq` and `notice_seq`, and `updated_at`, set on every save, which a retention job can key on | `id` |
| `haikit_payloads` | One row per payload, never updated. Each records the lease token its writer held, which is what `sweepOrphans` checks | `(conversation_id, handle)` |
| `haikit_notices` | One row per notice, never updated | `(conversation_id, seq)` |

Payloads and notices reference their conversation with `ON DELETE CASCADE`.
`haikit_payloads` has an index on `created_at`. Later releases add columns
with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so `migrate` upgrades a schema
from an earlier release. With your own migration tool, apply the new
statements from `schema` before deploying a release that adds them.

## Across servers with Postgres

### `NOTICE_CHANNEL`

```ts
const NOTICE_CHANNEL = "haikit_notices";
```

The channel `putNotice` notifies on, with the conversation id as the payload.
`watch` listens on it.

### `TURN_CHANNEL`

```ts
const TURN_CHANNEL = "haikit_turns";
```

The channel `publish` sends on, and `subscribe` listens on, for wake turns,
signals and presence alike.

**How a message travels.** Postgres refuses a `NOTIFY` payload of 8,000 bytes
or more. So `publish` encodes the message as base64 and splits it into pieces
of at most 7,000 characters, each sent as `<conversation id> <message id>
<index> <count> <piece>`, all in one statement. A listening store puts them
back together. A message's pieces that don't all arrive within 30,000 ms are
given up on. Pieces that don't hold together, from anything else notifying on
the channel, are dropped. Messages for one conversation are sent one at a
time, each committed before the next, so they arrive in order. Like every
`NOTIFY`, it's best effort: a server whose listening connection is down
misses them.

Anything that can `NOTIFY` on the database can send on this channel, and the
runtime trusts what it hears (see
[Signals and presence](signals.md#across-servers)).

### `MAX_PUBLISH_BYTES`

```ts
const MAX_PUBLISH_BYTES: number;   // 52_500_000
```

The longest message `publish` takes, in UTF-8 bytes: what 10,000 pieces of
base64 hold. A longer message is refused with a `RangeError`, `message too
long to publish: <n> bytes, over the 52500000-byte maximum`, and not sent.

## Cleaning up

### `sweepOrphans`

```ts
function sweepOrphans(db: Queryable, options: SweepOptions): Promise<{ deleted: number }>;
```

Deletes orphaned payloads, and resolves to how many it deleted. A payload is
an orphan when it's older than `olderThanMs`, its conversation's `handles`
doesn't include its handle, **and** the conversation's lease has been issued
to someone else since the payload was written.

```ts
import { sweepOrphans } from "@haikit/postgres";

await sweepOrphans(pool, { olderThanMs: 24 * 60 * 60 * 1000 });
```

- **The lease token is the proof,** not the age. A turn writes its payloads
  before it saves, so a payload the history doesn't refer to may simply not
  be saved yet. Nor is an expired lease proof: a turn slower than the lease
  time keeps running, and if nobody took over, its save still succeeds. Only
  a newer token proves the writer can never save again.
- **So a crashed turn's payloads stay until the conversation is next used,**
  when a new token is issued. That's the safe direction.
- It never touches notices, or conversations: deleting whole conversations is
  retention policy, and left to the app.

Run it on a schedule. `memoryStore` has no equivalent.

### `SweepOptions`

```ts
interface SweepOptions {
  olderThanMs: number;
}
```

| Option | Meaning |
| --- | --- |
| `olderThanMs` | Only payloads older than this, by the database's clock, are swept. A grace period for operators, not a safety bound: no value can delete a payload a turn will still refer to |
