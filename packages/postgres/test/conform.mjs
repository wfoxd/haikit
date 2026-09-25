#!/usr/bin/env node
/**
 * @haikit/postgres against the shared StoreAdapter conformance suite.
 *
 * Always runs against PGlite — real Postgres compiled to WebAssembly, running in
 * this process — so the SQL is exercised with no server to install.
 *
 * With HAIKIT_PG_URL set, it also runs against a real server, and adds the
 * checks a single process never could: many connections racing for one lease,
 * and many concurrent renders numbering handles in one conversation. Those are
 * what the atomicity clauses in the core contract are actually about.
 *
 *   node packages/postgres/test/conform.mjs
 *   HAIKIT_PG_URL=postgres://postgres:pw@localhost:5432/postgres node packages/postgres/test/conform.mjs
 */

import { PGlite } from "@electric-sql/pglite";
import { conform, integration, failureCount } from "../../../scripts/storetest.mjs";
import { pgStore, migrate, sweepOrphans } from "../dist/index.js";
import { isConversationBusy } from "../../core/dist/index.js";

let local = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  local++;
};
const check = (name, cond) => (cond ? ok(name) : bad(name));

const payload = (conversationId, mode = "display") => ({
  conversationId,
  component: "c",
  version: 1,
  props: { rows: [1, 2, 3] },
  mode,
});

/** Checks specific to this adapter, not part of the shared contract. */
async function adapterChecks(label, db) {
  console.log(`\n${label} — adapter`);
  const store = pgStore(db);

  // handles are numbered per conversation, so the digests read ui_01 each time
  {
    const a = await store.loadConversation(undefined);
    const b = await store.loadConversation(undefined);
    const ha = await store.putPayload(payload(a.id), a.leaseToken);
    const hb = await store.putPayload(payload(b.id), b.leaseToken);
    check("handles are numbered per conversation", ha === "ui_01" && hb === "ui_01");
    check(
      "the same handle in two conversations resolves to each one's own row",
      (await store.getPayload("ui_01", a.id)).conversationId === a.id &&
        (await store.getPayload("ui_01", b.id)).conversationId === b.id,
    );
  }

  // a conversation survives a store instance going away — the reason this exists
  {
    const a = await store.loadConversation(undefined);
    a.status = "awaiting";
    a.pending = { toolUseId: "t1", handle: "ui_01", digest: "d", results: [] };
    a.messages.push({ role: "user", content: "hello" });
    a.leaseUntil = null;
    await store.saveConversation(a);

    const reopened = await pgStore(db).loadConversation(a.id); // a new process, same database
    check(
      "a parked turn survives a restart",
      reopened.status === "awaiting" &&
        reopened.pending?.handle === "ui_01" &&
        reopened.messages[0]?.content === "hello",
    );
  }

  // "no pending turn" is SQL NULL, not the JSON value null
  {
    const a = await store.loadConversation(undefined);
    a.leaseUntil = null;
    await store.saveConversation(a);
    const { rows } = await db.query(`SELECT pending IS NULL AS is_null FROM haikit_conversations WHERE id = $1`, [a.id]);
    check("a cleared pending turn is stored as SQL NULL", rows[0].is_null === true);
  }

  // orphan sweep removes only what no history references, and never mid-turn
  {
    const keep = await store.loadConversation(undefined);
    const kept = await store.putPayload(payload(keep.id), keep.leaseToken);
    const orphan = await store.putPayload(payload(keep.id), keep.leaseToken);
    keep.handles.push(kept); // only `kept` made it into the surviving history
    keep.leaseUntil = null;
    await store.saveConversation(keep);

    const busy = await store.loadConversation(undefined); // lease still live
    const inFlight = await store.putPayload(payload(busy.id), busy.leaseToken);

    await db.query(`UPDATE haikit_payloads SET created_at = now() - interval '1 hour'`);
    await sweepOrphans(db, { olderThanMs: 60_000 });

    check("sweep keeps a payload the history references", (await store.getPayload(kept, keep.id)) !== null);
    check("sweep removes an orphaned payload", (await store.getPayload(orphan, keep.id)) === null);
    check(
      "sweep never touches a conversation with a turn in flight",
      (await store.getPayload(inFlight, busy.id)) !== null,
    );
  }
}

/** Only meaningful against a real server with real parallel connections. */
async function concurrencyChecks(pool) {
  console.log("\npostgres — concurrency (real connections)");
  const store = pgStore(pool);
  const N = 20;

  // Open N connections first and hold them all at once, so the pool has N idle
  // clients ready. Without this the pool opens connections lazily, each one
  // takes longer to establish than a whole acquisition, and the "concurrent"
  // requests quietly run one after another — which passes even against a
  // read-then-write implementation. It did, before this was added.
  await Promise.all(Array.from({ length: N }, () => pool.query("SELECT pg_sleep(0.05)")));

  // N instances race for one released lease. Exactly one may win.
  {
    const c = await store.loadConversation(undefined);
    c.leaseUntil = null;
    await store.saveConversation(c);

    const results = await Promise.allSettled(Array.from({ length: N }, () => store.loadConversation(c.id)));
    const won = results.filter((r) => r.status === "fulfilled").length;
    const busy = results.filter((r) => r.status === "rejected" && isConversationBusy(r.reason)).length;
    check(`${N} concurrent acquisitions: exactly one wins (${won} won, ${busy} refused)`, won === 1 && busy === N - 1);
  }

  // N concurrent renders in one conversation never share a handle.
  {
    const c = await store.loadConversation(undefined);
    const handles = await Promise.all(
      Array.from({ length: N }, () => store.putPayload(payload(c.id), c.leaseToken)),
    );
    const expected = Array.from({ length: N }, (_, i) => `ui_${String(i + 1).padStart(2, "0")}`);
    check(
      `${N} concurrent renders get ${N} distinct, gapless handles`,
      new Set(handles).size === N && [...handles].sort().join() === expected.sort().join(),
    );
  }
}

// ── PGlite: always ─────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await migrate(db);
  await migrate(db); // idempotent
  await conform("postgres (PGlite)", (opts) => pgStore(db, opts));
  await integration("postgres (PGlite)", (opts) => pgStore(db, opts));
  await adapterChecks("postgres (PGlite)", db);
  await db.close();
}

// ── a real server: when one is provided ────────────────────────────────────
if (process.env.HAIKIT_PG_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.HAIKIT_PG_URL, max: 25 });
  try {
    await pool.query(`DROP TABLE IF EXISTS haikit_payloads, haikit_conversations`);
    await migrate(pool);
    await conform("postgres (server)", (opts) => pgStore(pool, opts));
    await integration("postgres (server)", (opts) => pgStore(pool, opts));
    await adapterChecks("postgres (server)", pool);
    await concurrencyChecks(pool);
  } finally {
    await pool.end();
  }
} else {
  console.log("\n  skipped: real-server concurrency checks (set HAIKIT_PG_URL)");
}

const total = failureCount() + local;
console.log(total ? `\n${total} check(s) failed\n` : "\npostgres: all checks passed\n");
process.exit(total ? 1 : 0);
