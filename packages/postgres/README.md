# @haikit/postgres

A durable `StoreAdapter` for haikit. Swap it in for `memoryStore()` before you
ship: a parked `elicit` turn is durable state, and a conversation that loses it
can never be sent again.

```ts
import pg from "pg";
import { createHai } from "@haikit/server";
import { pgStore, migrate } from "@haikit/postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);

const hai = createHai({ store: pgStore(pool), model, tools, surfaces, system });
```

## Bring your own driver

`pgStore` takes anything with `query(text, params) → Promise<{ rows }>`. A
`pg.Pool`, a `pg.Client` and PGlite all fit as they are, so this package depends
on `@haikit/core` and nothing else — pooling, TLS and connection lifecycle stay
yours.

## Why it is safe to run on several instances

- **One statement per operation.** Every fenced write checks the turn's lease
  token inside the same `UPDATE` or `INSERT … SELECT` that performs it. There is
  no read-then-write anywhere, so there is nothing to race and no transaction to
  forget.
- **The database's clock.** Lease expiry is computed with `now()`, never
  `Date.now()`, so clock skew between app servers cannot hand one conversation
  to two of them.
- **Write-once payloads.** Everything about a surface that changes over a
  conversation lives on the fenced conversation row, so no payload write can
  disagree with the history that references it.

The test suite runs twenty real connections at one released lease and requires
exactly one to win.

## Schema

Three tables, `haikit_conversations`, `haikit_payloads` and `haikit_notices`. `migrate()` creates
them if they do not exist and brings existing ones up to date; if you use your
own migration tool, the statements are exported as `schema`.

**Upgrading to 0.4:** `migrate()` adds `stale_after_ms` to `haikit_payloads`:
the freshness window each payload was rendered under, so a later deploy that
renames a surface or relaxes its window cannot make data already shown last
longer. If you call `migrate()` at startup as above, there is nothing to do.
With your own migration tool, apply the new `ALTER TABLE` from `schema` before
deploying. Rows written before the column existed are held to the window your
code declares.

**Upgrading to 0.12:** `migrate()` adds `haikit_notices`, and `notice_seq` and
`noticed_through` to `haikit_conversations`, for `hai.notify`. As before, if
you call `migrate()` at startup there is nothing to do.

Handles are numbered per conversation, so every conversation's digests start at
`ui_01`.

## Notices

A notice is one `INSERT … SELECT`, numbered under the conversation's row lock,
so two notices in one conversation always commit in the order they were
numbered and a reader resuming after one can never miss an earlier. It takes no
lease token: a notice lands whoever holds the turn. The same statement sends a
`NOTIFY` on `haikit_notices` with the conversation id.

Give the store a connection that can `LISTEN`, and the events route hears of a
notice the moment it lands, rather than at its next two-second read. It needs a
connection of its own: a pooled one goes back to the pool and stops listening.
PGlite fits as it is (`pgStore(db, { listen: db })`). With `pg`:

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

A notice belongs to its conversation and goes when it does: deleting a
conversation deletes its notices. `sweepOrphans` never touches them.

## Cleaning up

A turn that is overtaken mid-flight can leave payload rows that the surviving
history never references. They are inert — an interaction on one is refused —
but they are still rows:

```ts
import { sweepOrphans } from "@haikit/postgres";

await sweepOrphans(pool, { olderThanMs: 24 * 60 * 60 * 1000 });
```

A row is swept only when no history references it **and** the turn that wrote
it can never save again — which is proven by the conversation's lease having
been issued to someone else since. An expired lease is not enough: a turn slower
than its TTL keeps running, and if nobody took over, its save still succeeds.
So `olderThanMs` is a grace period, not a safety bound; no value of it can
delete a payload a turn is still going to reference.

A turn that crashed leaves its rows until the conversation is next used, since
only then is a new token issued. Deleting whole conversations is retention
policy, not garbage collection, and is left to you.
