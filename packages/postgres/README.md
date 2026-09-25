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

Two tables, `haikit_conversations` and `haikit_payloads`. `migrate()` creates
them if they do not exist; if you use your own migration tool, the statements
are exported as `schema`.

Handles are numbered per conversation, so every conversation's digests start at
`ui_01`.

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
