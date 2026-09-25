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

  // An unreferenced row is only an orphan once its writer can never save.
  {
    // the turn that wrote `orphan` finished without referencing it, and the
    // conversation has since been leased again — that writer is done for good
    const keep = await store.loadConversation(undefined);
    const kept = await store.putPayload(payload(keep.id), keep.leaseToken);
    const orphan = await store.putPayload(payload(keep.id), keep.leaseToken);
    keep.handles.push(kept);
    keep.leaseUntil = null;
    await store.saveConversation(keep);
    const next = await store.loadConversation(keep.id); // a later turn: new token
    next.leaseUntil = null;
    await store.saveConversation(next);

    // a turn still holding its lease, mid-way between render and save
    const busy = await store.loadConversation(undefined);
    const inFlight = await store.putPayload(payload(busy.id), busy.leaseToken);

    await db.query(`UPDATE haikit_payloads SET created_at = now() - interval '1 hour'`);
    await sweepOrphans(db, { olderThanMs: 60_000 });

    check("sweep keeps a payload the history references", (await store.getPayload(kept, keep.id)) !== null);
    check("sweep removes a payload whose writer was superseded", (await store.getPayload(orphan, keep.id)) === null);
    check("sweep never touches a turn still holding its lease", (await store.getPayload(inFlight, busy.id)) !== null);
  }

  // A turn slower than its lease keeps running, and if nobody took the
  // conversation over, its save still succeeds. Sweeping on "lease expired"
  // deleted its payload in that window and left the saved history pointing at
  // a missing row. Only a superseded token proves the writer is finished.
  {
    const short = pgStore(db, { leaseMs: 40 });
    const slow = await short.loadConversation(undefined);
    const h = await short.putPayload(payload(slow.id), slow.leaseToken);
    slow.handles.push(h); // in memory only — not saved yet
    await new Promise((r) => setTimeout(r, 70)); // the lease lapses; nobody takes over

    await db.query(`UPDATE haikit_payloads SET created_at = now() - interval '1 hour'`);
    await sweepOrphans(db, { olderThanMs: 60_000 }); // runs mid-turn

    slow.leaseUntil = null;
    await short.saveConversation(slow); // succeeds: the token was never superseded
    const saved = await short.loadConversation(slow.id);
    check(
      "sweep keeps a payload whose turn outlived its lease",
      saved.handles.includes(h) && (await short.getPayload(h, slow.id)) !== null,
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

/**
 * The sweep/save invariant under real contention: no interleaving of turns,
 * lease takeovers and sweeps may leave a saved history pointing at a payload
 * that no longer exists. Randomised rather than scripted, because the races
 * that matter are the ones nobody thought to script — the first version of
 * sweepOrphans had exactly such a race and passed every scripted check.
 */
async function sweepRaceChecks(pool) {
  const short = pgStore(pool, { leaseMs: 25 });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const c = await short.loadConversation(undefined);
    c.leaseUntil = null;
    await short.saveConversation(c);
    ids.push(c.id);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 3000;
  let saves = 0;
  let superseded = 0;
  let sweeps = 0;

  // 8 turns on 6 conversations, each render followed by a pause that often
  // outlives the 25ms lease — sometimes someone takes over, sometimes nobody
  // does and the slow turn's save still succeeds. Both are the cases a sweep
  // has to get right.
  const worker = async () => {
    while (Date.now() < deadline) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      let c;
      try {
        c = await short.loadConversation(id);
      } catch {
        await sleep(2);
        continue;
      }
      const h = await short.putPayload(payload(id), c.leaseToken).catch(() => null);
      if (!h) continue;
      c.handles.push(h);
      await sleep(Math.random() * 50);
      c.leaseUntil = null;
      try {
        await short.saveConversation(c);
        saves++;
      } catch {
        superseded++;
      }
    }
  };
  const sweeper = async () => {
    while (Date.now() < deadline) {
      await sweepOrphans(pool, { olderThanMs: 0 }); // no grace period at all
      sweeps++;
      await sleep(3);
    }
  };
  await Promise.all([...Array.from({ length: 8 }, worker), sweeper()]);

  const { rows } = await pool.query(
    `SELECT c.id, h.handle
       FROM haikit_conversations c, jsonb_array_elements_text(c.handles) AS h(handle)
      WHERE c.id = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM haikit_payloads p WHERE p.conversation_id = c.id AND p.handle = h.handle)`,
    [ids],
  );
  check(
    `turns, takeovers and sweeps racing leave no dangling handle ` +
      `(${saves} saves, ${superseded} superseded, ${sweeps} sweeps, ${rows.length} dangling)`,
    rows.length === 0 && saves > 0 && superseded > 0 && sweeps > 0,
  );
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
  const url = process.env.HAIKIT_PG_URL;

  // Every run works inside a schema of its own, created here and dropped at the
  // end. Every test connection's search_path is that schema alone, so the
  // suite's unqualified haikit_* table names cannot resolve to anything that
  // existed before it ran — pointing HAIKIT_PG_URL at a real database by
  // mistake cannot read, write or drop its data. The name is generated from
  // hex digits only, so interpolating it as an identifier is safe.
  const isolated = `haikit_test_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${isolated}`);
  const pool = new pg.Pool({ connectionString: url, max: 25, options: `-c search_path=${isolated}` });

  try {
    const { rows } = await pool.query(`SELECT current_schema() AS schema`);
    if (rows[0].schema !== isolated) throw new Error(`refusing to run: connections resolve to ${rows[0].schema}`);
    console.log(`\n  real server: running in throwaway schema ${isolated}`);
    await migrate(pool);
    await conform("postgres (server)", (opts) => pgStore(pool, opts));
    await integration("postgres (server)", (opts) => pgStore(pool, opts));
    await adapterChecks("postgres (server)", pool);
    await concurrencyChecks(pool);
    await sweepRaceChecks(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${isolated} CASCADE`);
    await admin.end();
  }
} else {
  console.log("\n  skipped: real-server concurrency checks (set HAIKIT_PG_URL)");
}

const total = failureCount() + local;
console.log(total ? `\n${total} check(s) failed\n` : "\npostgres: all checks passed\n");
process.exit(total ? 1 : 0);
