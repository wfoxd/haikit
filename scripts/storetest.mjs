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

  // ── a lease TTL that would disable mutual exclusion is refused ────────
  // Zero or negative expires every lease the moment it is taken, so every load
  // acquires; Infinity strands a crashed turn's conversation forever. Neither
  // may be accepted quietly.
  {
    const refused = (leaseMs) => {
      try {
        make({ leaseMs });
        return false;
      } catch (err) {
        return err instanceof RangeError;
      }
    };
    check(
      "a zero, negative, NaN or infinite lease TTL is refused",
      [0, -1, NaN, Infinity].every(refused),
    );
  }

  // ── payload props of every JSON type survive a round trip ─────────────
  // A store that stores JSON and guesses on the way out whether it still needs
  // parsing breaks on string scalars: "hello" comes back as a JS string, looks
  // like unparsed text, and JSON.parse throws.
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    const shapes = ["hello", "", 42, true, null, [1, "two"], { nested: { deep: ["x"] } }];
    const handles = [];
    for (const props of shapes) {
      handles.push(await s.putPayload({ ...payload(a.id), props }, a.leaseToken));
    }
    let single = [];
    let batch = [];
    let error = null;
    try {
      for (const h of handles) single.push((await s.getPayload(h, a.id)).props);
      batch = (await s.getPayloads(handles, a.id)).map((r) => r.props);
    } catch (err) {
      error = err;
    }
    const same = (got) => JSON.stringify(got) === JSON.stringify(shapes);
    check("payload props of every JSON type round-trip, including bare strings", !error && same(single) && same(batch));
  }

  // ── createdAt is when the payload was written, in epoch milliseconds ──
  // Every freshness window is measured from it. The runtime fails closed on a
  // value that isn't a number, but a wrong number it cannot detect: seconds
  // instead of milliseconds would close every conversation on its first
  // request.
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    const before = Date.now();
    const h = await s.putPayload(payload(a.id), a.leaseToken);
    const after = Date.now();
    const single = (await s.getPayload(h, a.id))?.createdAt;
    const [batched] = await s.getPayloads([h], a.id);
    const slack = 60_000; // a database server's clock may differ a little from this one
    check(
      "createdAt is epoch milliseconds from when the payload was written",
      typeof single === "number" && single >= before - slack && single <= after + slack,
    );
    check("the batch read reports the same createdAt", batched?.createdAt === single);
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
    // …and like repeated single reads, every result is its own object
    repeated[0].props.rows.push("mutated");
    check(
      "duplicate batch results do not share nested state",
      repeated[2].props.rows.length === 3 && (await s.getPayload(h2, a.id)).props.rows.length === 3,
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
  await expiryChecks(make);
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
  const pickerImpl = picker.implement({
    digest: () => "d",
    actions: { choose: (v) => `chose ${v}` },
    queries: {},
    staleAfterMs: "never",
  });

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
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (mode === "fail-slow") {
        await wait(40);
        open--;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "the old request failed" }));
        return;
      }
      // "split" answers at once and sends the rest of its stream 40ms later
      if (mode !== "split") await wait(mode === "late-refusal" ? 100 : 40);
      const frame = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.writeHead(200, { "content-type": "text/event-stream" });
      frame({ type: "hello", conversationId: "conv_1", model: "m" });
      if (mode === "split") await wait(40);
      if (mode === "expiring" || mode === "server-refuses" || mode === "split") {
        // a picker good for 40ms
        frame({ type: "ui_open", handle: "ui_01", toolId: "b1", component: "c", version: 1, mode: "elicit", staleAfterMs: 40 });
        frame({ type: "ui_props", handle: "ui_01", props: {} });
      }
      if (mode === "server-refuses" || mode === "late-refusal") frame({ type: "expired", message: "server says" });
      frame({ type: "status", status: "idle" });
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

    // ── a tab left open closes the conversation on time, by itself
    const endpoint = "http://127.0.0.1:5378/hai";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    mode = "expiring";
    const tab = createChat({ endpoint, registry: {} });
    await tab.send("show me");
    check(
      "the deadline is known as soon as the surface arrives",
      typeof tab.state.expiresAt === "number" && tab.state.expired === null,
    );
    await sleep(70);
    check(
      "an open tab closes the conversation when the window passes",
      typeof tab.state.expired === "string" && tab.state.blocks.at(-1)?.kind === "expired",
    );
    received.length = 0;
    await tab.interact("ui_01", "choose", "x");
    await tab.send("still there?");
    check("an out-of-date conversation sends nothing more", received.length === 0);

    // the local deadline passes while a request is open, and the server's
    // refusal arrives after it — the order that needs de-duplicating
    mode = "expiring";
    const slow = createChat({ endpoint, registry: {} });
    await slow.send("show me"); // a picker good for 40ms
    mode = "late-refusal"; // the next answer takes 100ms, and is a refusal
    await slow.send("again");
    check(
      "a refusal arriving after the local deadline adds no second notice",
      slow.state.blocks.filter((b) => b.kind === "expired").length === 1,
    );

    // the other order: the server says it first
    mode = "server-refuses";
    const told = createChat({ endpoint, registry: {} });
    await told.send("hi");
    await sleep(70);
    check(
      "the server's refusal and the local deadline make one notice, not two",
      told.state.expired === "server says" && told.state.blocks.filter((b) => b.kind === "expired").length === 1,
    );

    // ── reset() starts over
    tab.reset();
    const s = tab.state;
    check(
      "reset() clears the conversation",
      s.conversationId === null && s.blocks.length === 0 && s.surfaces.size === 0 &&
        s.expired === null && s.expiresAt === null,
    );
    mode = "ok";
    received.length = 0;
    await tab.send("a new one");
    check(
      "the next send starts a new conversation",
      received.length === 1 && received[0].body.conversationId == null && tab.state.conversationId === "conv_1",
    );

    // a request still open cannot pull the client back into what it left
    const racing = createChat({ endpoint, registry: {} });
    const inFlight = racing.send("slow"); // the server holds it for 40ms
    await sleep(10);
    racing.reset();
    await inFlight;
    check(
      "events from a request open during reset() are dropped",
      racing.state.conversationId === null && racing.state.blocks.length === 0,
    );

    // a stream already delivering when reset() lands stops applying mid-way
    mode = "split";
    const midway = createChat({ endpoint, registry: {} });
    const streaming = midway.send("hi");
    for (let i = 0; i < 100 && midway.state.conversationId === null; i++) await sleep(2);
    midway.reset(); // `hello` has landed; the surface is 40ms away
    await streaming;
    check(
      "the rest of a stream open during reset() is dropped",
      midway.state.conversationId === null && midway.state.blocks.length === 0 && midway.state.expiresAt === null,
    );

    // a request that fails after reset() does not report into the new one
    mode = "fail-slow";
    const failing = createChat({ endpoint, registry: {} });
    const doomed = failing.send("hi");
    await sleep(10);
    failing.reset();
    await doomed;
    check("an old request's failure is not shown in the new conversation", failing.state.blocks.length === 0);

    // …and one still queued is never sent at all
    mode = "ok";
    received.length = 0;
    const queued = createChat({ endpoint, registry: {} });
    const sends = [queued.send("one"), queued.send("two")];
    queued.reset();
    await Promise.all(sends);
    check("sends queued before reset() are never sent", received.length === 0);
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
  const cardImpl = card.implement({ digest: () => "a card", actions: {}, queries: {}, staleAfterMs: "never" });

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

// ── an out-of-date conversation is closed ───────────────────────────────
// Once any surface is past its freshness window, every request — typed or
// clicked — is refused before the model runs, and nothing is recorded. The
// user starts a new conversation; the model is never asked to cope with it.
async function expiryChecks(make) {
  console.log("\nexpiry");
  const { createHai, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineSurface, resolve, inform } = await import("../packages/core/dist/index.js");
  const http = await import("node:http");
  const any = { parse: (v) => v };
  const later = () => new Promise((r) => setTimeout(r, 70));

  const surface = (name, staleAfterMs) =>
    defineSurface({ name, version: 1, props: any, actions: { choose: resolve(any), note: inform(any) }, queries: {} })
      .implement({
        digest: () => name,
        actions: { choose: (v) => `chose ${v}`, note: (v) => `noted ${v}` },
        queries: {},
        staleAfterMs,
      });
  const quick = surface("quick", 40);
  const forever = surface("forever", "never");

  let generations = 0;
  const model = {
    id: "stub",
    async generate() {
      generations++;
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const store = make();
  const hai = createHai({ model, store, tools: [], surfaces: [quick, forever], system: "x" });

  /** A saved conversation that rendered these surfaces. `parked` leaves the
   *  first one awaiting an answer; `answered` freezes it as already answered. */
  async function conversation(impls, { parked = false, answered = false } = {}) {
    const c = await store.loadConversation(undefined);
    for (const impl of impls) {
      c.handles.push(
        await store.putPayload(
          { conversationId: c.id, component: impl.surface.name, version: 1, props: {}, mode: parked ? "elicit" : "display" },
          c.leaseToken,
        ),
      );
    }
    if (parked) {
      c.status = "awaiting";
      c.pending = { toolUseId: "t1", handle: c.handles[0], digest: "d", results: [] };
    }
    if (answered) c.frozen.push(c.handles[0]);
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c;
  }

  /** One request, the way routes.ts runs it: acquire, act, release. */
  async function request(id, act, runtime = hai) {
    const c = await store.loadConversation(id);
    const events = [];
    const before = generations;
    await act(runtime, c, (e) => events.push(e));
    c.leaseUntil = null;
    await store.saveConversation(c);
    return { expired: events.find((e) => e.type === "expired"), modelCalls: generations - before };
  }
  const say = (text) => (rt, c, emit) => rt.send(c, text, emit);
  const click = (handle, action) => (rt, c, emit) => rt.interact(c, { handle, action, value: "x" }, emit);

  /** The stored conversation, without holding its lease afterwards. */
  async function peek(id) {
    const c = await store.loadConversation(id);
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c;
  }

  {
    const c = await conversation([quick]);
    const r = await request(c.id, say("hi"));
    check("inside its window, a conversation runs as before", !r.expired && r.modelCalls === 1);
  }

  {
    const c = await conversation([quick]);
    await later();
    const r = await request(c.id, say("hi"));
    check(
      "past its window, a typed message is refused with a way forward",
      /out of date.*Start a new conversation/.test(r.expired?.message ?? ""),
    );
    check("…before the model runs", r.modelCalls === 0);
    check("…and nothing is recorded", (await peek(c.id)).messages.length === 0);
  }

  // the case this exists for: a picker left open, clicked days later
  {
    const c = await conversation([quick], { parked: true });
    await later();
    const r = await request(c.id, click(c.handles[0], "choose"));
    const after = await peek(c.id);
    check("a click on an out-of-date picker is refused", !!r.expired && r.modelCalls === 0);
    check(
      "…and the picker is left unanswered, not resolved or frozen",
      after.pending?.handle === c.handles[0] && !after.frozen.includes(c.handles[0]),
    );
  }

  {
    const c = await conversation([quick, forever]);
    await later();
    const r = await request(c.id, click(c.handles[1], "note"));
    check("one out-of-date surface closes the whole conversation", !!r.expired && r.modelCalls === 0);
  }

  // what the user picked is still in the model's context at the old price
  {
    const c = await conversation([quick], { answered: true });
    await later();
    const r = await request(c.id, say("book it"));
    check("an answered surface still closes the conversation", !!r.expired && r.modelCalls === 0);
  }

  {
    const c = await conversation([forever]);
    await later();
    const r = await request(c.id, say("hi"));
    check('a "never" surface never closes a conversation', !r.expired && r.modelCalls === 1);
  }

  // A store returning an unreadable createdAt must not make every surface
  // fresh forever — NaN compares false against every deadline.
  {
    const unreadable = {
      ...store,
      getPayloads: async (handles, id) =>
        (await store.getPayloads(handles, id)).map((r) => ({ ...r, createdAt: Number.NaN })),
    };
    const strict = createHai({ model, store: unreadable, tools: [], surfaces: [quick, forever], system: "x" });
    const c = await conversation([quick]);
    const r = await request(c.id, say("hi"), strict);
    check("a payload whose age can't be read counts as out of date", !!r.expired && r.modelCalls === 0);
  }

  // over HTTP: refused inside the stream, and the lease is still released
  {
    const c = await conversation([quick]);
    await later();
    const handler = nodeHandler(hai, "/hai");
    const server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/hai/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: c.id, message: "hi" }),
      });
      const body = await res.text();
      check("the route streams the refusal", res.status === 200 && body.includes('"type":"expired"'));
      let released = true;
      try {
        await peek(c.id);
      } catch {
        released = false;
      }
      check("a refused request still releases its lease", released);
    } finally {
      server.close();
    }
  }
}

// ── a window has to be a real decision ──────────────────────────────────
// The type makes staleAfterMs required; JavaScript callers never see the type.
async function windowChecks() {
  console.log("\nfreshness windows");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const model = { id: "stub", async generate() { return { content: [], stop_reason: "end_turn" }; } };

  const refused = (staleAfterMs) => {
    const impl = defineSurface({ name: "w", version: 1, props: any, actions: {}, queries: {} }).implement({
      digest: () => "w",
      actions: {},
      queries: {},
      staleAfterMs,
    });
    try {
      createHai({ model, store: memoryStore(), tools: [], surfaces: [impl], system: "x" });
      return false;
    } catch (err) {
      return err instanceof RangeError && err.message.includes("surface w");
    }
  };
  check(
    "a missing, zero, negative, NaN, infinite or misspelled window is refused",
    [undefined, 0, -1, NaN, Infinity, "15m", "Never"].every(refused),
  );
  check('a positive window and "never" are accepted', !refused(1) && !refused("never"));
}

// Only when invoked directly. A Postgres adapter imports `conform` to run this
// same suite against itself, and must not inherit a run or a process.exit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await conform("memoryStore", (opts) => memoryStore(opts));
  await integration("memoryStore", (opts) => memoryStore(opts));
  await routeChecks();
  await windowChecks();
  await clientChecks();

  // Said plainly because a suite that looks exhaustive is worse than one that
  // admits its edges: nothing here can prove lease acquisition is atomic. This
  // process cannot interleave two acquisitions, so a read-then-write adapter
  // passes every check above and still races. Review that per adapter.
  console.log("\n  not covered: atomicity of lease acquisition or of fenced writes (single process)");

  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
