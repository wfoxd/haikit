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
    const h = await s.putPayload(payload(a.id), a.leaseToken);

    check("read is scoped to the owning conversation", (await s.getPayload(h, b.id)) === null);
    check("read succeeds for the owner", (await s.getPayload(h, a.id))?.handle === h);

    await s.freezePayload(h, b.id, b.leaseToken);
    check("freeze from another conversation is a no-op", (await s.getPayload(h, a.id)).state === "live");

    await s.freezePayload(h, a.id, a.leaseToken);
    check("freeze from the owner applies", (await s.getPayload(h, a.id)).state === "frozen");
  }

  // ── batch read matches the single read, and drops what it should ──────
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    a.leaseUntil = null;
    await s.saveConversation(a);
    const b = await s.loadConversation(undefined);
    const h1 = await s.putPayload(payload(a.id), a.leaseToken);
    const h2 = await s.putPayload(payload(a.id), a.leaseToken);
    const other = await s.putPayload(payload(b.id), b.leaseToken);

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

// ── an overtaken turn's surface cannot be interacted with ───────────────
// putPayload commits during the turn; the conversation save at the end may be
// rejected. The row therefore survives a takeover while the winning history
// never records its handle — and the browser that mounted it is still open.
async function orphanChecks() {
  console.log("\norphaned surfaces");
  const { createHai } = await import("../packages/server/dist/index.js");
  const store = memoryStore({ leaseMs: 40 });
  const hai = createHai({
    model: { id: "stub", async generate() { return { content: [], stop_reason: "end_turn" }; } },
    store,
    tools: [],
    surfaces: [],
    system: "x",
  });

  // a turn renders a surface, then loses its lease and is superseded
  const slow = await store.loadConversation(undefined);
  const handle = await store.putPayload(
    { conversationId: slow.id, component: "c", version: 1, props: {}, mode: "display", state: "live" },
    slow.leaseToken,
  );
  slow.handles.push(handle);

  await new Promise((r) => setTimeout(r, 70));
  const winner = await store.loadConversation(slow.id); // lease expired, taken
  winner.leaseUntil = null;
  await store.saveConversation(winner);

  let staleRejected = false;
  try {
    await store.saveConversation(slow);
  } catch (err) {
    staleRejected = isStaleLease(err);
  }
  check("the overtaken turn's save is rejected", staleRejected);

  const row = await store.getPayload(handle, slow.id);
  check("its payload row still exists (orphan)", row !== null);
  check("the winning history does not record the handle", !winner.handles.includes(handle));

  // the client that mounted it is still open and can still click
  const live = await store.loadConversation(slow.id);
  let refused = "";
  try {
    await hai.interact(live, { handle, action: "copy", value: {} }, () => {});
  } catch (err) {
    refused = err.message;
  }
  check("interacting with an orphaned handle is refused", refused === "unknown handle");
}

// ── a superseded turn cannot strand a conversation ──────────────────────
// Freezing is not like writing a new payload. It mutates a row the *winning*
// history still depends on: freeze the handle a parked turn is awaiting and
// that conversation awaits a surface that can never resolve, failing every
// later interaction with "component is frozen". Permanently unsendable — the
// exact outcome durable storage exists to prevent.
async function strandChecks() {
  console.log("\nstranding");
  const store = memoryStore({ leaseMs: 40 });

  const setup = await store.loadConversation(undefined);
  const handle = await store.putPayload(
    { conversationId: setup.id, component: "picker", version: 1, props: {}, mode: "elicit", state: "live" },
    setup.leaseToken,
  );
  setup.handles.push(handle);
  setup.status = "awaiting";
  setup.pending = { toolUseId: "t1", handle, digest: "d", results: [] };
  setup.leaseUntil = null;
  await store.saveConversation(setup);

  const slow = await store.loadConversation(setup.id); // /interact begins
  await new Promise((r) => setTimeout(r, 70)); // its lease expires mid-turn

  const winner = await store.loadConversation(setup.id); // still parked, taken over
  winner.leaseUntil = null;
  await store.saveConversation(winner);

  let freezeRefused = false;
  try {
    await store.freezePayload(handle, slow.id, slow.leaseToken);
  } catch (err) {
    freezeRefused = isStaleLease(err);
  }
  check("a superseded holder cannot freeze", freezeRefused);

  let putRefused = false;
  try {
    await store.putPayload(
      { conversationId: slow.id, component: "c", version: 1, props: {}, mode: "display", state: "live" },
      slow.leaseToken,
    );
  } catch (err) {
    putRefused = isStaleLease(err);
  }
  check("a superseded holder cannot write a payload", putRefused);

  const survived = await store.loadConversation(setup.id);
  const row = await store.getPayload(handle, setup.id);
  check(
    "the surviving conversation can still resolve what it awaits",
    survived.pending?.handle === handle && row.state === "live",
  );
}

// ── a 409 in the tail of the previous turn is not a user-visible error ──
// The server emits `awaiting` from inside the turn and releases its lease
// afterwards, and the composer is deliberately live in that state ("pick an
// option above — or type to override"). An override landing in that window is
// normal, so the client retries once rather than surfacing the refusal.
async function clientChecks() {
  console.log("\nclient");
  const { createChat } = await import("../packages/client/src/index.js");
  const http = await import("node:http");

  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    if (calls === 1) {
      // first attempt lands while the previous request is still releasing
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "conversation conv_1 is busy" }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "hello", conversationId: "conv_1", model: "m" })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "status", status: "idle" })}\n\n`);
    res.end();
  });
  await new Promise((r) => server.listen(5378, r));

  try {
    const chat = createChat({ endpoint: "http://127.0.0.1:5378/hai", registry: {} });
    await chat.send("override");

    check("a transient 409 is retried, not surfaced", !chat.state.blocks.some((b) => b.kind === "error"));
    check("the retry actually reached the server", calls === 2);
    check("the retried turn is applied", chat.state.conversationId === "conv_1");

    // a second request while one is in flight must not be sent at all
    calls = 0;
    const first = chat.send("one");
    const second = await chat.send("two").then(() => "returned");
    await first;
    check("a send while a request is in flight is dropped", second === "returned" && calls <= 2);
  } finally {
    server.close();
  }
}

// Only when invoked directly. A Postgres adapter imports `conform` to run this
// same suite against itself, and must not inherit a run or a process.exit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await conform("memoryStore", (opts) => memoryStore(opts));
  await routeChecks();
  await orphanChecks();
  await strandChecks();
  await clientChecks();

  // Said plainly because a suite that looks exhaustive is worse than one that
  // admits its edges: nothing here can prove lease acquisition is atomic. This
  // process cannot interleave two acquisitions, so a read-then-write adapter
  // passes every check above and still races. Review that per adapter.
  console.log("\n  not covered: atomicity of lease acquisition (single process)");

  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
