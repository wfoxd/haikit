#!/usr/bin/env node
/**
 * Conformance suite for StoreAdapter.
 *
 * Every rule here is one an in-process store could get away with ignoring and a
 * networked one cannot. They are asserted against `memoryStore` so that the
 * reference implementation and a real one cannot quietly diverge — when a
 * Postgres store lands, it runs this same file.
 *
 *   node scripts/storetest.mjs
 */

import { memoryStore } from "../packages/server/dist/store.js";
import { ConversationBusy, isConversationBusy, isStaleLease } from "../packages/core/dist/index.js";
import { pathToFileURL } from "node:url";

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};
const check = (name, cond) => (cond ? ok(name) : bad(name));

const payload = (conversationId) => ({
  conversationId,
  component: "c",
  version: 1,
  props: { rows: [1, 2, 3] },
  mode: "elicit",
  state: "live",
});

/** @param {() => import("@haikit/core").StoreAdapter} make */
export async function conform(label, make) {
  console.log(`\n${label}`);

  // ── handles are scoped to their conversation ──────────────────────────
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    a.leaseUntil = null;
    await s.saveConversation(a);
    const b = await s.loadConversation(undefined);
    const h = await s.putPayload(payload(a.id));

    check("read is scoped to the owning conversation", (await s.getPayload(h, b.id)) === null);
    check("read succeeds for the owner", (await s.getPayload(h, a.id))?.handle === h);

    await s.freezePayload(h, b.id);
    check("freeze from another conversation is a no-op", (await s.getPayload(h, a.id)).state === "live");

    await s.freezePayload(h, a.id);
    check("freeze from the owner applies", (await s.getPayload(h, a.id)).state === "frozen");
  }

  // ── batch read matches the single read, and drops what it should ──────
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    a.leaseUntil = null;
    await s.saveConversation(a);
    const b = await s.loadConversation(undefined);
    const h1 = await s.putPayload(payload(a.id));
    const h2 = await s.putPayload(payload(a.id));
    const other = await s.putPayload(payload(b.id));

    const got = await s.getPayloads([h1, h2, other, "ui_9999"], a.id);
    check(
      "batch returns only in-scope, existing handles",
      got.length === 2 && got.every((r) => [h1, h2].includes(r.handle)),
    );
    check("batch on an empty list returns empty", (await s.getPayloads([], a.id)).length === 0);
  }

  // ── one turn in flight per conversation ───────────────────────────────
  {
    const s = make();
    const a = await s.loadConversation(undefined); // load acquires the lease

    let busy = false;
    try {
      await s.loadConversation(a.id);
    } catch (err) {
      busy = isConversationBusy(err);
    }
    check("a second concurrent load is refused", busy);

    // the request boundary releases it, exactly as routes.ts does
    a.leaseUntil = null;
    await s.saveConversation(a);
    let reacquired = false;
    try {
      await s.loadConversation(a.id);
      reacquired = true;
    } catch {}
    check("released lease can be re-acquired", reacquired);
  }

  // ── a crashed process must not strand a conversation forever ──────────
  {
    const s = make({ leaseMs: 40 });
    const a = await s.loadConversation(undefined);
    void a;
    await new Promise((r) => setTimeout(r, 70));
    let stolen = false;
    try {
      await s.loadConversation(a.id);
      stolen = true;
    } catch {}
    check("an expired lease can be taken over", stolen);
  }

  // ── a new conversation is never handed out twice ──────────────────────
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    const b = await s.loadConversation(undefined);
    check("undefined id always creates a fresh conversation", a.id !== b.id);
  }

  // ── the loaded conversation is a copy, not stored state ───────────────
  // A store that returns a live reference cannot detect a stale writer, because
  // the caller's copy and the stored row are the same object.
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    a.messages.push({ role: "user", content: "not saved yet" });
    a.leaseUntil = null;
    await s.saveConversation({ ...a, messages: [] });

    const reloaded = await s.loadConversation(a.id);
    check("mutating a loaded conversation does not write through", reloaded.messages.length === 0);
  }

  // ── an overtaken turn cannot overwrite the turn that overtook it ──────
  // The reason expiry alone is not mutual exclusion: a request slower than the
  // TTL loses the lease while still running, and must not win the final write.
  {
    const s = make({ leaseMs: 40 });
    const slow = await s.loadConversation(undefined);

    await new Promise((r) => setTimeout(r, 70)); // slow turn outlives its lease

    const overtaker = await s.loadConversation(slow.id); // allowed: lease expired
    overtaker.messages.push({ role: "user", content: "newer turn" });
    overtaker.leaseUntil = null;
    await s.saveConversation(overtaker);

    let rejected = false;
    slow.messages.push({ role: "user", content: "stale turn" });
    slow.leaseUntil = null;
    try {
      await s.saveConversation(slow);
    } catch (err) {
      rejected = isStaleLease(err);
    }
    check("a superseded holder's save is rejected", rejected);

    const winner = await s.loadConversation(slow.id);
    check(
      "the newer turn's messages survive",
      winner.messages.length === 1 && winner.messages[0].content === "newer turn",
    );
  }

  // ── the rightful holder's save still succeeds ─────────────────────────
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    a.messages.push({ role: "user", content: "mine" });
    a.leaseUntil = null;
    let saved = true;
    try {
      await s.saveConversation(a);
    } catch {
      saved = false;
    }
    check("an uncontested save succeeds", saved);
  }

  return failures;
}

// ── the route turns a refused lease into a status code ──────────────────
// Driven with a store that always refuses, rather than by racing two real
// turns: a scripted turn finishes in tens of milliseconds, so a timing-based
// test passes or fails on scheduler luck.
async function routeChecks() {
  console.log("\nroutes");
  const { createHai, nodeHandler } = await import("../packages/server/dist/index.js");
  const http = await import("node:http");

  const busyStore = {
    ...memoryStore(),
    async loadConversation(id) {
      throw new ConversationBusy(id ?? "conv_1");
    },
  };
  const hai = createHai({
    model: { id: "stub", async generate() { return { content: [], stop_reason: "end_turn" }; } },
    store: busyStore,
    tools: [],
    surfaces: [],
    system: "x",
  });
  const handler = nodeHandler(hai, "/hai");
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5377, r));

  try {
    const res = await fetch("http://127.0.0.1:5377/hai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conv_1", message: "hi" }),
    });
    const body = await res.json().catch(() => ({}));
    check("a refused lease is a 409, not a crash", res.status === 409);
    check("the 409 carries a reason", typeof body.error === "string" && body.error.includes("busy"));
  } finally {
    server.close();
  }
}

// Only when invoked directly. A Postgres adapter imports `conform` to run this
// same suite against itself, and must not inherit a run or a process.exit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await conform("memoryStore", (opts) => memoryStore(opts));
  await routeChecks();
  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
