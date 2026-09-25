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

    // Payloads are write-once. Anything that changes about a surface lives on
    // the fenced conversation row, so a store offering a way to mutate one would
    // reopen the split-write hole that Conversation.frozen closes.
    check("the store exposes no payload mutation", !("freezePayload" in s));
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
    // b gets more payloads than a, so its last handle exists only in b under
    // any numbering scheme. (With per-conversation numbering b's first handle
    // is also "ui_01" — a handle a legitimately has — and asking for it would
    // test nothing about scope.)
    await s.putPayload(payload(b.id), b.leaseToken);
    await s.putPayload(payload(b.id), b.leaseToken);
    const onlyInB = await s.putPayload(payload(b.id), b.leaseToken);
    check("the out-of-scope handle really does not exist in a", (await s.getPayload(onlyInB, a.id)) === null);

    const got = await s.getPayloads([h1, h2, onlyInB, "ui_9999"], a.id);
    check(
      "batch returns only in-scope, existing handles",
      got.length === 2 && got[0].handle === h1 && got[1].handle === h2 && got.every((r) => r.conversationId === a.id),
    );
    check("batch on an empty list returns empty", (await s.getPayloads([], a.id)).length === 0);

    // defined as getPayload once per input handle: order kept, duplicates kept
    const repeated = await s.getPayloads([h2, h1, h2], a.id);
    check(
      "batch keeps input order and duplicates, like repeated single reads",
      repeated.map((r) => r.handle).join() === [h2, h1, h2].join(),
    );
  }

  // ── handles stay unique well past two digits ──────────────────────────
  // A store that formats handles with SQL lpad() truncates rather than pads:
  // lpad('100', 2, '0') is '10', and handle 100 collides with handle 10.
  {
    // A store with a unique constraint turns the collision into a thrown
    // duplicate-key error rather than a duplicate — report either as a failure.
    const s = make();
    const a = await s.loadConversation(undefined);
    const handles = [];
    let error = null;
    try {
      for (let i = 0; i < 101; i++) handles.push(await s.putPayload(payload(a.id), a.leaseToken));
    } catch (err) {
      error = err;
    }
    check("handles stay unique past ui_99", !error && new Set(handles).size === 101);
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
  // the caller's copy and the stored row are the same object. The mutation is
  // never saved: the lease simply lapses and the conversation is loaded again.
  // (An earlier version of this check saved an empty message list, which
  // overwrote whatever a shared object had leaked — it could not fail.)
  {
    const s = make({ leaseMs: 30 });
    const created = await s.loadConversation(undefined);
    created.leaseUntil = null;
    await s.saveConversation(created);

    const a = await s.loadConversation(created.id); // the path every turn takes
    a.messages.push({ role: "user", content: "never saved" });
    a.handles.push("ui_never_saved");
    await new Promise((r) => setTimeout(r, 50)); // lease lapses; nothing written

    const reloaded = await s.loadConversation(created.id);
    check(
      "mutating a loaded conversation does not write through",
      reloaded.messages.length === 0 && reloaded.handles.length === 0,
    );
  }

  // ── a write must present a lease this store issued ────────────────────
  // The documented compare-and-set rejects these for free — no row matches an
  // unknown id, and NULL never equals a token — so a store must reject them
  // too, or a caller holding no lease at all can create state nobody owns.
  {
    const s = make();
    const refused = async (fn) => {
      try {
        await fn();
        return false;
      } catch (err) {
        return isStaleLease(err);
      }
    };

    check(
      "a payload write for an unknown conversation is refused",
      await refused(() => s.putPayload(payload("conv_unknown"), "any-token")),
    );

    // Guards against the realistic adapter bug: reading "no token" as "no
    // fencing requested" and skipping the comparison.
    const a = await s.loadConversation(undefined);
    check(
      "a payload write with a null token is refused",
      await refused(() => s.putPayload(payload(a.id), null)),
    );

    check(
      "saving a conversation that was never loaded is refused",
      await refused(() =>
        s.saveConversation({
          id: "conv_never_loaded",
          status: "idle",
          messages: [],
          handles: [],
          frozen: [],
          pending: null,
          leaseUntil: null,
          leaseToken: null,
        }),
      ),
    );
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

/**
 * The runtime-level scenarios, run against any store. These are the ones
 * durable storage exists for — a turn overtaken mid-flight, a surface left
 * orphaned, a conversation that must not be stranded — so an adapter that only
 * passes `conform` has not been tested where it matters.
 */
export async function integration(label, make) {
  console.log(`\n${label} — runtime`);
  await orphanChecks(make);
  await strandChecks(make);
  await turnAbortChecks(make);
  return failures;
}

export const failureCount = () => failures;

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
async function orphanChecks(make) {
  console.log("\norphaned surfaces");
  const { createHai } = await import("../packages/server/dist/index.js");
  const store = make({ leaseMs: 40 });
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
    { conversationId: slow.id, component: "c", version: 1, props: {}, mode: "display" },
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
// Answering an elicit surface is one transition with two halves: the surface
// stops accepting clicks, and the history records what was chosen. When the
// first half lived on the payload and the second on the conversation, a turn
// could freeze the payload while it still legitimately held the lease, lose the
// lease during the model call, and have its save rejected — leaving the winning
// history awaiting a surface nobody can click again. Checked in both orders:
// the takeover landing before the freeze, and after it.
async function strandChecks(make) {
  console.log("\nstranding");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, resolve } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const picker = defineSurface({ name: "picker", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} });
  const pickerImpl = picker.implement({ digest: () => "d", actions: { choose: (v) => `chose ${v}` }, queries: {} });

  // a model slow enough to outlive a 40ms lease
  const slowModel = {
    id: "slow",
    async generate() {
      await new Promise((r) => setTimeout(r, 90));
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };

  async function parked(store) {
    const c = await store.loadConversation(undefined);
    const handle = await store.putPayload(
      { conversationId: c.id, component: "picker", version: 1, props: {}, mode: "elicit" },
      c.leaseToken,
    );
    c.handles.push(handle);
    c.status = "awaiting";
    c.pending = { toolUseId: "t1", handle, digest: "d", results: [] };
    c.leaseUntil = null;
    await store.saveConversation(c);
    return { id: c.id, handle };
  }

  // ── takeover AFTER the freeze: the freeze was legitimate when it happened
  {
    const store = make({ leaseMs: 40 });
    const hai = createHai({ model: slowModel, store, tools: [], surfaces: [pickerImpl], system: "x" });
    const { id, handle } = await parked(store);

    const a = await store.loadConversation(id);
    const aTurn = hai.interact(a, { handle, action: "choose", value: "he" }, () => {}); // freezes, then waits on the model
    await new Promise((r) => setTimeout(r, 60)); // A's lease has expired mid-call
    const b = await store.loadConversation(id); // B takes over from pre-A history
    await aTurn;

    let aRejected = false;
    try {
      a.leaseUntil = null;
      await store.saveConversation(a);
    } catch (err) {
      aRejected = isStaleLease(err);
    }
    check("the superseded resolution is rejected", aRejected);
    check("the winning history does not see the lost freeze", !b.frozen.includes(handle));

    let clicked = "";
    try {
      await hai.interact(b, { handle, action: "choose", value: "he" }, () => {});
      clicked = "resolved";
    } catch (err) {
      clicked = err.message;
    }
    check("the surviving conversation can still resolve what it awaits", clicked === "resolved");
  }

  // ── takeover BEFORE the write: a superseded holder cannot write at all
  {
    const store = make({ leaseMs: 40 });
    const { id } = await parked(store);
    const slow = await store.loadConversation(id);
    await new Promise((r) => setTimeout(r, 70));
    const winner = await store.loadConversation(id);
    winner.leaseUntil = null;
    await store.saveConversation(winner);

    let putRefused = false;
    try {
      await store.putPayload(
        { conversationId: slow.id, component: "c", version: 1, props: {}, mode: "display" },
        slow.leaseToken,
      );
    } catch (err) {
      putRefused = isStaleLease(err);
    }
    check("a superseded holder cannot write a payload", putRefused);
  }
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

  // The server records what it received and how many requests were ever open at
  // once. Each response is held briefly, so overlap would be observable if the
  // client let two requests out together.
  let mode = "409-once";
  let calls = 0;
  let open = 0;
  let maxOpen = 0;
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      calls++;
      if (mode === "409-once" && calls === 1) {
        // lands while the previous request is still releasing its lease
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "conversation conv_1 is busy" }));
        return;
      }
      open++;
      maxOpen = Math.max(maxOpen, open);
      received.push({ path: req.url, body: JSON.parse(raw) });
      await new Promise((r) => setTimeout(r, 40));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "hello", conversationId: "conv_1", model: "m" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "status", status: "idle" })}\n\n`);
      open--;
      res.end();
    });
  });
  await new Promise((r) => server.listen(5378, r));

  try {
    // ── the tail of the previous turn is not a user-visible error
    const chat = createChat({ endpoint: "http://127.0.0.1:5378/hai", registry: {} });
    await chat.send("override");
    check("a transient 409 is retried, not surfaced", !chat.state.blocks.some((b) => b.kind === "error"));
    check("the retry actually reached the server", calls === 2);
    check("the retried turn is applied", chat.state.conversationId === "conv_1");

    // ── a message typed while a request is open is queued, never dropped.
    // mountChat clears the textarea before calling send(), so a refused send
    // is not declined — it is deleted.
    mode = "ok";
    received.length = 0;
    maxOpen = 0;
    const fresh = createChat({ endpoint: "http://127.0.0.1:5378/hai", registry: {} });
    await Promise.all([fresh.send("one"), fresh.send("two")]);
    const messages = received.map((r) => r.body.message);
    check("a send during an open request is delivered, not dropped", messages.includes("two"));
    check("queued sends go out in the order they were made", messages.join(",") === "one,two");
    check("queued sends never overlap on the wire", maxOpen === 1);
    check(
      "a queued send inherits the conversation the first one created",
      received[1]?.body.conversationId === "conv_1",
    );

    // ── a click while busy is dropped rather than stacked: a double-click on a
    // picker row would otherwise resolve it and then queue "component is frozen"
    received.length = 0;
    await Promise.all([fresh.send("three"), fresh.interact("ui_01", "choose", "he")]);
    check(
      "an interaction while a request is open is not stacked",
      received.length === 1 && received[0].path.endsWith("/chat"),
    );
  } finally {
    server.close();
  }
}

// ── a fence tripped inside a tool stops the turn ────────────────────────
// putPayload runs inside tool.run(), and the runtime turns tool errors into a
// "tool failed" result for the model. A StaleLease must not take that path: it
// would hand the lost lease back to the model as information and keep paying
// for hops whose output the fenced save will discard.
async function turnAbortChecks(make) {
  console.log("\nsuperseded turns");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool } = await import("../packages/core/dist/index.js");
  const store = make({ leaseMs: 40 });
  const any = { parse: (v) => v };

  const card = defineSurface({ name: "card", version: 1, props: any, actions: {}, queries: {} });
  const cardImpl = card.implement({ digest: () => "a card", actions: {}, queries: {} });

  let conversationId;
  const show = defineTool({
    name: "show",
    description: "render a card",
    input: any,
    inputJsonSchema: { type: "object", properties: {} },
    async run(_input, ctx) {
      await new Promise((r) => setTimeout(r, 70)); // this turn outlives its lease
      const winner = await store.loadConversation(conversationId); // and is taken over
      winner.leaseUntil = null;
      await store.saveConversation(winner);
      return ctx.render(cardImpl, {}); // fenced write — must trip
    },
  });

  let generations = 0;
  const hai = createHai({
    model: {
      id: "stub",
      async generate() {
        generations++;
        return generations === 1
          ? { content: [{ type: "tool_use", id: "tu1", name: "show", input: {} }], stop_reason: "tool_use" }
          : { content: [{ type: "text", text: "kept going" }], stop_reason: "end_turn" };
      },
    },
    store,
    tools: [show],
    surfaces: [cardImpl],
    system: "x",
  });

  const conversation = await store.loadConversation(undefined);
  conversationId = conversation.id;
  let thrown = null;
  try {
    await hai.send(conversation, "show me", () => {});
  } catch (err) {
    thrown = err;
  }
  check("a fence tripped inside a tool aborts the turn", isStaleLease(thrown));
  check("no further model hops after the fence trips", generations === 1);
}

// Only when invoked directly. A Postgres adapter imports `conform` to run this
// same suite against itself, and must not inherit a run or a process.exit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await conform("memoryStore", (opts) => memoryStore(opts));
  await integration("memoryStore", (opts) => memoryStore(opts));
  await routeChecks();
  await clientChecks();

  // Said plainly because a suite that looks exhaustive is worse than one that
  // admits its edges: nothing here can prove lease acquisition is atomic. This
  // process cannot interleave two acquisitions, so a read-then-write adapter
  // passes every check above and still races. Review that per adapter.
  console.log("\n  not covered: atomicity of lease acquisition or of fenced writes (single process)");

  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
