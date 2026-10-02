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

  // ── a payload's window comes back exactly as it went in ───────────────
  // It is what holds data to the window it was shown under after a deploy
  // renames the surface or relaxes its window. "never" is a string, and a
  // store that turns it into a number, null or Infinity has lost it.
  {
    const s = make();
    const a = await s.loadConversation(undefined);
    const windows = [900_000, "never", 1];
    const handles = [];
    for (const staleAfterMs of windows) {
      handles.push(await s.putPayload({ ...payload(a.id), staleAfterMs }, a.leaseToken));
    }
    const single = [];
    for (const h of handles) single.push((await s.getPayload(h, a.id))?.staleAfterMs);
    const batched = (await s.getPayloads(handles, a.id)).map((r) => r.staleAfterMs);
    const same = (got) => JSON.stringify(got) === JSON.stringify(windows);
    check(`a payload's window round-trips, "never" included`, same(single) && same(batched));
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
  await initChecks(make);
  await actionChecks(make);
  await oneQuestionChecks(make);
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
// history awaiting a surface nobody can click again. Both halves now live on
// the conversation, and a click is saved before the model runs, so a takeover
// during the model call starts from the answered surface. Checked in both
// orders: the takeover landing before the freeze, and after it.
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

  // ── takeover AFTER the freeze: the click was saved before the model ran
  {
    const store = make({ leaseMs: 40 });
    const hai = createHai({ model: slowModel, store, tools: [], surfaces: [pickerImpl], system: "x" });
    const { id, handle } = await parked(store);

    const a = await store.loadConversation(id);
    const aTurn = hai.interact(a, { handle, action: "choose", value: "he" }, () => {}); // freezes, saves, then waits on the model
    await new Promise((r) => setTimeout(r, 60)); // A's lease has expired mid-call
    const b = await store.loadConversation(id); // B takes over from A's saved click
    await aTurn;

    let aRejected = false;
    try {
      a.leaseUntil = null;
      await store.saveConversation(a);
    } catch (err) {
      aRejected = isStaleLease(err);
    }
    check("the superseded turn's final save is rejected", aRejected);
    check(
      "the winning history starts from the click, saved before the model ran",
      b.frozen.includes(handle) && b.pending === null && b.status === "idle" &&
        b.messages.at(-1)?.content?.[0]?.type === "tool_result",
    );

    let clicked = "";
    try {
      await hai.interact(b, { handle, action: "choose", value: "he" }, () => {});
      clicked = "resolved";
    } catch (err) {
      clicked = err.message;
    }
    check("…so the surface cannot be answered, and its handler run, twice", clicked === "component is frozen");
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
  const hanging = [];
  let calls = 0;
  let open = 0;
  let maxOpen = 0;
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      calls++;
      if (mode === "409-always" || (mode === "409-once" && calls === 1)) {
        // lands while the previous request is still releasing its lease
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "conversation conv_1 is busy" }));
        return;
      }
      open++;
      maxOpen = Math.max(maxOpen, open);
      received.push({ path: req.url, body: JSON.parse(raw) });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      const hello = { type: "hello", conversationId: "conv_1", model: "m" };
      const picker = (staleAfterMs) => [
        { type: "ui_open", handle: "ui_01", toolId: "b1", component: "c", version: 1, mode: "elicit", staleAfterMs },
        { type: "ui_props", handle: "ui_01", props: {} },
      ];
      const idle = { type: "status", status: "idle" };
      // what the server has recorded, sent at the end of every turn it keeps
      const context = { type: "context", messages: [{ role: "user", content: "x" }], modelTokens: 1, uiTokens: 0 };

      if (mode === "fail-slow") {
        // the failure's headers arrive at once, its body 40ms later
        res.writeHead(500, { "content-type": "application/json" });
        res.flushHeaders();
        await wait(40);
        open--;
        res.end(JSON.stringify({ error: "the old request failed" }));
        return;
      }
      if (mode === "hang") {
        // a stream that stays open, like a long model turn
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sse(hello));
        hanging.push(res);
        open--;
        return;
      }
      if (mode === "one-chunk") {
        // everything in a single write, so it arrives as a single chunk
        await wait(40);
        res.writeHead(200, { "content-type": "text/event-stream" });
        open--;
        res.end(sse(hello, ...picker(120), idle));
        return;
      }

      // "split" answers at once and sends the rest of its stream 40ms later;
      // "slow-render" is a turn whose surface arrives 150ms after the request
      if (mode !== "split") await wait({ "late-refusal": 250, "slow-turn": 250, "slow-render": 150 }[mode] ?? 40);
      const frame = (event) => res.write(sse(event));
      res.writeHead(200, { "content-type": "text/event-stream" });
      frame(hello);
      if (mode === "split") await wait(40);
      if (["expiring", "server-refuses", "split", "slow-render", "surface"].includes(mode)) {
        picker(mode === "slow-render" ? 200 : mode === "surface" ? undefined : 120).forEach(frame);
      }
      if (mode === "answered") {
        picker(undefined).forEach(frame);
        frame({ type: "ui_state", handle: "ui_01", state: "frozen", selection: "he" });
      }
      const refused = mode === "server-refuses" || mode === "late-refusal";
      if (refused) frame({ type: "expired", message: "server says" });
      frame(idle);
      if (!refused) frame(context);
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

    // ── start() opens the conversation before anything is typed
    mode = "ok";
    received.length = 0;
    const opening = createChat({ endpoint: "http://127.0.0.1:5378/hai", registry: {} });
    await opening.start();
    await opening.send("hello");
    check(
      "start() posts /start with no conversation, and the first message joins the one it opened",
      received[0]?.path.endsWith("/start") && received[0].body.conversationId == null &&
        received[1]?.path.endsWith("/chat") && received[1].body.conversationId === "conv_1",
    );
    received.length = 0;
    const again = await opening.start();
    check("start() does nothing once the conversation has begun", again === false && received.length === 0);

    // ── a tab left open closes the conversation on time, by itself
    const endpoint = "http://127.0.0.1:5378/hai";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    mode = "expiring";
    const tab = createChat({ endpoint, registry: {} });
    await tab.send("show me"); // a picker good for 120ms, arriving ~40ms in
    check(
      "the deadline is known as soon as the surface arrives",
      typeof tab.state.expiresAt === "number" && tab.state.expired === null,
    );

    // The server stamps a surface after the request arrives, so the browser
    // counts from when it sent the request. Counting from arrival would run
    // late by however long the turn took, or a proxy held the stream.
    mode = "slow-render";
    const slowTurn = createChat({ endpoint, registry: {} });
    const sentAt = Date.now();
    await slowTurn.send("show me"); // the surface arrives ~150ms in, good for 200ms
    const counted = slowTurn.state.expiresAt - sentAt;
    check(
      `the browser's deadline is counted from the request, not the arrival (${counted}ms of a 200ms window)`,
      counted >= 190 && counted < 275,
    );
    slowTurn.reset();
    mode = "expiring";
    await sleep(150);
    check(
      "an open tab closes the conversation when the window passes",
      typeof tab.state.expired === "string" && tab.state.blocks.at(-1)?.kind === "expired",
    );
    received.length = 0;
    await tab.interact("ui_01", "choose", "x");
    await tab.send("still there?");
    check("an out-of-date conversation sends nothing more", received.length === 0);

    // A laptop that slept through the deadline has not run the timer yet. A
    // click is dropped while a request is open, but it must still close the
    // conversation — the clock says so even though the timer has not.
    mode = "expiring";
    const asleep = createChat({ endpoint, registry: {} });
    await asleep.send("show me"); // a picker good for 120ms; its timer is still pending
    mode = "hang";
    received.length = 0;
    void asleep.send("another turn"); // stays open, so the client is busy
    // wait until it has really gone out, so only the click can notice the clock
    for (let i = 0; i < 100 && !received.some((r) => r.body.message === "another turn"); i++) await sleep(2);
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000; // the wall clock jumped; the timer did not fire
    try {
      await asleep.interact("ui_01", "choose", "x");
    } finally {
      Date.now = realNow;
    }
    check("a click while busy still closes a conversation past its deadline", asleep.state.expired !== null);
    asleep.reset();

    // send() refuses before its first await, so a caller that clears its input
    // (mountChat does) can see the refusal straight away and keep the text
    mode = "expiring";
    const typing = createChat({ endpoint, registry: {} });
    await typing.send("show me");
    Date.now = () => realNow() + 60_000; // past the deadline; the timer has not fired
    let refusedAtOnce = false;
    try {
      const pending = typing.send("typed after the deadline");
      refusedAtOnce = typing.state.expired !== null; // before anything is awaited
      await pending;
    } finally {
      Date.now = realNow;
    }
    check("send() refuses an out-of-date conversation at once, not later", refusedAtOnce);
    typing.reset();

    // a message queued behind a long turn is not sent once the deadline passes
    // while it waits — the conversation closed before its turn came
    mode = "expiring";
    const queuedPast = createChat({ endpoint, registry: {} });
    await queuedPast.send("show me"); // a picker good for 120ms, arriving ~40ms in
    mode = "slow-turn"; // the turn ahead is accepted, and takes 250ms
    received.length = 0;
    const outcomes = await Promise.all([queuedPast.send("ahead"), queuedPast.send("queued behind it")]);
    check(
      "a message queued past the deadline is never sent",
      received.some((r) => r.body.message === "ahead") && !received.some((r) => r.body.message === "queued behind it"),
    );
    // the default UI cleared the text box when it queued; this is how it knows
    // to give the text back instead of losing it
    check(
      "send() reports which one went out: true for the first, false for the one turned away",
      outcomes[0] === true && outcomes[1] === false,
    );

    // a 409 waits 150ms and retries once; a deadline passing in that wait
    // stops the retry like it stops any other send
    mode = "expiring";
    const retrying = createChat({ endpoint, registry: {} });
    await retrying.send("show me"); // a picker good for 120ms, arriving ~40ms in
    mode = "409-once";
    calls = 0; // so this next call is the refused one
    received.length = 0;
    const retried = await retrying.send("refused, then retried past the deadline");
    check(
      "a 409 retry is not sent once the deadline passes during its wait",
      calls === 1 && received.length === 0 && retrying.state.expired !== null && retried === false,
    );

    // still busy after the retry: the server turned the message away unread,
    // so it did not go out, and the UI can give the text back
    mode = "409-always";
    const blocked = createChat({ endpoint, registry: {} });
    const taken = await blocked.send("while another tab holds the turn");
    check(
      "a message the server keeps refusing as busy reports that it did not go out",
      taken === false && blocked.state.blocks.some((b) => b.kind === "error"),
    );

    // the local deadline passes while a request is open, and the server's
    // refusal arrives after it — the order that needs de-duplicating
    mode = "expiring";
    const slow = createChat({ endpoint, registry: {} });
    await slow.send("show me"); // a picker good for 120ms, arriving ~40ms in
    mode = "late-refusal"; // the next answer takes 250ms, and is a refusal
    const againTaken = await slow.send("again");
    check(
      "a refusal arriving after the local deadline adds no second notice",
      slow.state.blocks.filter((b) => b.kind === "expired").length === 1,
    );
    // the server answered 200 but refused inside the stream: it recorded
    // nothing, so the message was not taken and the text can come back
    check("a message the server refuses as expired reports that it did not go out", againTaken === false);

    // the other order: the server says it first
    mode = "server-refuses";
    const told = createChat({ endpoint, registry: {} });
    await told.send("hi");
    await sleep(150); // past the local deadline too
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
    const went = await tab.send("a new one");
    check(
      "the next send starts a new conversation, and reports that it went out",
      received.length === 1 && received[0].body.conversationId == null && tab.state.conversationId === "conv_1" && went === true,
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

    // a subscriber that resets mid-chunk: the rest of that chunk is the old
    // conversation's, even though it has already been read off the wire
    mode = "one-chunk";
    const eager = createChat({ endpoint, registry: {} });
    eager.subscribe((_s, event) => {
      if (event.type === "hello") eager.reset();
    });
    await eager.send("hi");
    check(
      "a reset from inside a subscriber drops the rest of the chunk",
      eager.state.conversationId === null && eager.state.surfaces.size === 0 && eager.state.expiresAt === null,
    );

    // an old stream that is still open does not hold up the new conversation
    mode = "hang";
    const stuck = createChat({ endpoint, registry: {} });
    const abandoned = stuck.send("a long turn");
    for (let i = 0; i < 100 && stuck.state.conversationId === null; i++) await sleep(2);
    stuck.reset();
    mode = "ok";
    received.length = 0;
    const within = (p, ms) => Promise.race([p.then(() => true, () => false), sleep(ms).then(() => false)]);
    check(
      "a new conversation is not queued behind a stream the old one left open",
      await within(stuck.send("a new one"), 1000),
    );
    await stuck.interact("ui_01", "choose", "x");
    check("…and the old stream no longer counts as busy", received.some((r) => r.path.endsWith("/interact")));
    check("the abandoned request settles without an error", await within(abandoned, 1000));

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
    const results = await Promise.all(sends);
    check(
      "sends queued before reset() are never sent, and say so",
      received.length === 0 && results.every((sent) => sent === false),
    );

    // ── a surface has one instance at a time, let go of when it goes
    mode = "surface";
    const log = [];
    let instances = 0;
    const lifecycleRegistry = {
      c: {
        mount() {
          const id = ++instances;
          log.push(`mount ${id}`);
          return { unmount: () => log.push(`unmount ${id}`) };
        },
      },
    };
    const element = () => ({ replaceChildren() {}, dataset: {} });
    const lifecycle = createChat({ endpoint, registry: lifecycleRegistry });
    await lifecycle.send("show it");
    lifecycle.mount("ui_01", element());
    lifecycle.mount("ui_01", element());
    check("mounting a surface again unmounts the instance it had first", log.join() === "mount 1,unmount 1,mount 2");
    lifecycle.reset();
    check("reset() unmounts every surface", log.at(-1) === "unmount 2" && lifecycle.state.surfaces.size === 0);

    // a surface mounted again once answered still knows what was picked
    mode = "answered";
    const remembered = [];
    const remembering = createChat({
      endpoint,
      registry: { c: { mount: (_el, _props, ctx) => void remembered.push([ctx.state, ctx.selection]) } },
    });
    await remembering.send("pick he");
    remembering.mount("ui_01", element());
    check("a surface mounted once it is answered is told what was picked", JSON.stringify(remembered) === '[["frozen","he"]]');

    // ── close(): done for good, even with a turn still open
    await lifecycle.send("show it again");
    lifecycle.mount("ui_01", element());
    mode = "hang";
    const open = hanging.length;
    const lastTurn = lifecycle.send("a long turn");
    for (let i = 0; i < 100 && hanging.length === open; i++) await sleep(2);
    const heard = [];
    lifecycle.subscribe((_s, event) => heard.push(event.type));
    lifecycle.close();
    check(
      "close() unmounts every surface, ends the turn still open, and says so",
      log.at(-1) === "unmount 3" && heard.at(-1) === "closed" && (await within(lastTurn, 1000)),
    );
    mode = "ok";
    received.length = 0;
    const heardBefore = heard.length;
    const after = [await lifecycle.send("hello?"), await lifecycle.start(), lifecycle.mount("ui_01", element())];
    await lifecycle.interact("ui_01", "choose", "x");
    lifecycle.reset();
    check(
      "after close() nothing is sent, mounted or heard",
      after.join() === "false,false," && received.length === 0 && heard.length === heardBefore && log.at(-1) === "unmount 3",
    );

    // a request waiting out a 409 when the chat closes, past its deadline
    mode = "expiring";
    const waiting = createChat({ endpoint, registry: {} });
    await waiting.send("show it"); // a surface good for 120ms
    mode = "409-always";
    const turnedAway = waiting.send("again"); // turned away, then waits 150ms to retry
    await sleep(10);
    waiting.close();
    await turnedAway;
    check(
      "a request still waiting when the chat closes changes nothing after it",
      waiting.state.expired === null && !waiting.state.blocks.some((b) => b.kind === "expired"),
    );

    // a component that throws on its way out doesn't stop the reset
    mode = "surface";
    const breaking = createChat({
      endpoint,
      registry: {
        c: {
          mount: () => ({
            unmount() {
              throw new Error("unmount broke");
            },
          }),
        },
      },
    });
    await breaking.send("show it");
    breaking.mount("ui_01", element());
    const brokeWith = [];
    const onBreak = (err) => brokeWith.push(err.message);
    process.on("uncaughtException", onBreak);
    breaking.reset();
    await sleep(10);
    process.off("uncaughtException", onBreak);
    mode = "ok";
    check(
      "a component that throws in unmount() doesn't stop the reset, and its error is reported",
      breaking.state.conversationId === null && breaking.state.surfaces.size === 0 && brokeWith.join() === "unmount broke",
    );

    // a subscriber that throws when told doesn't stop the others being told
    const closing = createChat({ endpoint, registry: {} });
    const toldOfClose = [];
    const reported = [];
    const report = (err) => reported.push(err.message);
    process.on("uncaughtException", report);
    closing.subscribe(() => {
      throw new Error("subscriber broke");
    });
    closing.subscribe((_s, event) => toldOfClose.push(event.type));
    closing.close();
    await sleep(10);
    process.off("uncaughtException", report);
    check(
      "a subscriber that throws on close() doesn't stop the others hearing it, and its error is reported",
      toldOfClose.join() === "closed" && reported.join() === "subscriber broke",
    );
  } finally {
    for (const res of hanging) res.end();
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
  const { defineSurface, defineTool, resolve, inform } = await import("../packages/core/dist/index.js");
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
  // declares no window at all, as every surface written before 0.4 does
  const unset = defineSurface({ name: "unset", version: 1, props: any, actions: {}, queries: {} }).implement({
    digest: () => "unset",
    actions: {},
    queries: {},
  });

  let generations = 0;
  const model = {
    id: "stub",
    async generate() {
      generations++;
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const store = make();
  const hai = createHai({ model, store, tools: [], surfaces: [quick, forever, unset], system: "x" });

  /** A saved conversation that rendered these surfaces, each recording its
   *  window as the runtime does. `parked` leaves the first awaiting an answer;
   *  `answered` freezes it; `legacy` writes rows from before windows existed. */
  async function conversation(impls, { parked = false, answered = false, legacy = false } = {}) {
    const c = await store.loadConversation(undefined);
    for (const impl of impls) {
      c.handles.push(
        await store.putPayload(
          {
            conversationId: c.id,
            component: impl.surface.name,
            version: 1,
            props: {},
            mode: parked ? "elicit" : "display",
            staleAfterMs: legacy ? null : impl.impl.staleAfterMs,
          },
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

  // ── the window is the one the data was shown under ────────────────────
  // A later deploy runs different code against the same stored conversations.
  // It may tighten a window; it may not relax one for data already shown.
  const deploy = (...surfaces) => createHai({ model, store, tools: [], surfaces, system: "x" });

  /** Render `impl` through a real tool call; what was stored and sent. */
  async function render(impl) {
    const show = defineTool({
      name: "show",
      description: "render it",
      input: any,
      inputJsonSchema: { type: "object", properties: {} },
      run: (_input, ctx) => ctx.render(impl, {}),
    });
    let step = 0;
    const rendering = createHai({
      model: {
        id: "r",
        async generate() {
          return step++ === 0
            ? { content: [{ type: "tool_use", id: "tu1", name: "show", input: {} }], stop_reason: "tool_use" }
            : { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
        },
      },
      store,
      tools: [show],
      surfaces: [quick, forever, unset],
      system: "x",
    });
    const c = await store.loadConversation(undefined);
    const events = [];
    await rendering.send(c, "show me", (e) => events.push(e));
    c.leaseUntil = null;
    await store.saveConversation(c);
    const open = events.find((e) => e.type === "ui_open");
    return { id: c.id, stored: (await store.getPayload(c.handles[0], c.id))?.staleAfterMs, sent: open && "staleAfterMs" in open ? open.staleAfterMs : "absent" };
  }

  {
    const r = await render(quick);
    check("a render records the window it was shown under, and sends it", r.stored === 40 && r.sent === 40);
  }

  // no window declared means "never": nothing breaks for code written before
  {
    const r = await render(unset);
    await later();
    const after = await request(r.id, say("still there?"));
    check(
      'a surface with no window records "never" and sends none',
      r.stored === "never" && r.sent === "absent",
    );
    check("…and never closes its conversation", !after.expired && after.modelCalls === 1);
  }

  {
    const c = await conversation([quick]);
    await later();
    const r = await request(c.id, say("hi"), deploy(surface("quick", "never"), forever));
    check('a deploy that relaxes the window to "never" does not revive old data', !!r.expired && r.modelCalls === 0);
  }

  {
    const c = await conversation([quick]);
    await later();
    const r = await request(c.id, say("hi"), deploy(surface("quick", 60_000), forever));
    check("a deploy that relaxes it to a longer window does not either", !!r.expired && r.modelCalls === 0);
  }

  {
    const c = await conversation([quick]);
    await later();
    const r = await request(c.id, say("hi"), deploy(forever));
    check("a deploy that removes the surface does not revive old data", !!r.expired && r.modelCalls === 0);
  }

  {
    const c = await conversation([forever]); // recorded as "never"
    await later();
    const r = await request(c.id, say("hi"), deploy(quick, surface("forever", 40)));
    check("a deploy that tightens the window applies to old data", !!r.expired && r.modelCalls === 0);
  }

  // rows written before windows existed are held to what the code says now
  {
    const stale = await conversation([quick], { legacy: true });
    const fresh = await conversation([forever], { legacy: true });
    await later();
    const r1 = await request(stale.id, say("hi"));
    const r2 = await request(fresh.id, say("hi"));
    check(
      "an old row with no recorded window is held to the current one",
      !!r1.expired && !r2.expired && r2.modelCalls === 1,
    );
  }

  // …and one whose surface is gone too has no window anywhere: it proves
  // nothing is fresh, so it expires at once
  {
    const c = await conversation([quick], { legacy: true });
    const r = await request(c.id, say("hi"), deploy(forever));
    check(
      "a payload whose window is known nowhere counts as out of date",
      /can no longer be checked/.test(r.expired?.message ?? "") && r.modelCalls === 0,
    );
  }

  // Nothing deletes a payload the history references, so a missing one is lost
  // data. getPayloads omits it silently; the conversation must not look fresh
  // because the one surface that could have closed it is no longer there.
  {
    const c = await conversation([forever]);
    const loaded = await store.loadConversation(c.id);
    loaded.handles.push("ui_77"); // referenced, but no row behind it
    loaded.leaseUntil = null;
    await store.saveConversation(loaded);
    const r = await request(c.id, say("hi"));
    check(
      "a referenced payload that is missing counts as out of date",
      /can no longer be checked/.test(r.expired?.message ?? "") && r.modelCalls === 0,
    );
  }

  // A store returning an unreadable createdAt must fail closed. Each of these
  // reaches the deadline arithmetic differently: NaN compares false, Infinity
  // compares fresh forever, a string concatenates, null adds as zero.
  {
    const bad = [Number.NaN, Infinity, -Infinity, "yesterday", null, undefined, 1n, Symbol("t")];
    const refusedFor = [];
    for (const createdAt of bad) {
      const unreadable = {
        ...store,
        getPayloads: async (handles, id) =>
          (await store.getPayloads(handles, id)).map((r) => ({ ...r, createdAt })),
      };
      const strict = createHai({ model, store: unreadable, tools: [], surfaces: [quick, forever], system: "x" });
      const c = await conversation([quick]); // fresh by its real timestamp
      const r = await request(c.id, say("hi"), strict);
      if (r.expired && r.modelCalls === 0) refusedFor.push(createdAt);
    }
    check(
      `a payload whose age can't be read counts as out of date (${refusedFor.length}/${bad.length}: NaN, ±Infinity, string, null, undefined, bigint, symbol)`,
      refusedFor.length === bad.length,
    );
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

// ── the init tool runs first, once, and cannot be skipped ───────────────
// The runtime makes the call itself, before the model's first turn, and
// records it as if the model had: the user's message, the call, its result.
async function initChecks(make) {
  console.log("\ninit tool");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool, resolve, isStaleLease } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make({ leaseMs: 40 });

  let runs = 0;
  let behaviour = "ok"; // what the init tool does next: ok | throw | pick | card | slow
  const picker = defineSurface({ name: "account", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} })
    .implement({ digest: () => "2 accounts: personal, work", actions: { choose: (v) => `Chose ${v}.` }, queries: {} });
  const card = defineSurface({ name: "welcome", version: 1, props: any, actions: {}, queries: {} })
    .implement({ digest: () => "welcome card", actions: {}, queries: {} });
  let takeover = null; // set by the "slow" behaviour to the conversation it overtakes
  const init = defineTool({
    name: "load_profile",
    description: "Load the user's profile.",
    input: any,
    inputJsonSchema: { type: "object", properties: {} },
    async run(_input, ctx) {
      runs++;
      if (behaviour === "throw") throw new Error("profile service unavailable");
      if (behaviour === "show-then-throw") {
        await ctx.render(card, {}); // a surface is already out when it fails
        throw new Error("profile service unavailable");
      }
      if (behaviour === "pick") return ctx.render(picker, {}, { mode: "elicit" });
      if (behaviour === "pick-then-note") {
        await ctx.render(picker, {}, { mode: "elicit" });
        return ctx.text("Profile loaded.");
      }
      if (behaviour === "card") return ctx.render(card, {});
      if (behaviour === "slow-text") {
        await new Promise((r) => setTimeout(r, 70)); // outlives the 40ms lease
        const winner = await store.loadConversation(takeover);
        winner.leaseUntil = null;
        await store.saveConversation(winner);
        return ctx.text("Profile: Ada."); // no fenced write of its own
      }
      if (behaviour === "slow") {
        await new Promise((r) => setTimeout(r, 70)); // outlives the 40ms lease
        const winner = await store.loadConversation(takeover);
        winner.leaseUntil = null;
        await store.saveConversation(winner);
        return ctx.render(card, {}); // fenced write: must trip
      }
      return ctx.text("Profile: Ada, home airport SFO.");
    },
  });

  // the model records every request it gets; on request it calls a tool once
  const seen = [];
  let callNext = null;
  const model = {
    id: "stub",
    async generate(req) {
      seen.push(JSON.parse(JSON.stringify({ messages: req.messages, tools: req.tools })));
      if (callNext) {
        const name = callNext;
        callNext = null;
        return { content: [{ type: "tool_use", id: `tu_${seen.length}`, name, input: {} }], stop_reason: "tool_use" };
      }
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const hai = createHai({ model, store, tools: [], surfaces: [picker, card], system: "x", init });

  async function request(id, act) {
    const c = await store.loadConversation(id);
    const events = [];
    let error = null;
    try {
      await act(c, (e) => events.push(e));
    } catch (err) {
      error = err;
    }
    c.leaseUntil = null;
    if (!isStaleLease(error)) await store.saveConversation(c);
    return { c, events, error };
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);

  // ── it runs first, and the model sees it as its own call
  let id;
  {
    runs = 0;
    seen.length = 0;
    const r = await request(undefined, say("hi"));
    id = r.c.id;
    const [first] = seen;
    const m = first?.messages ?? [];
    const call = m[1]?.content?.[0];
    check(
      "init runs once, before the model's first turn",
      runs === 1 && seen.length === 1 && !r.error,
    );
    check(
      "the model's first request is: the user's message, then init's call, then its result",
      m.length === 3 && m[0].role === "user" && m[0].content === "hi" &&
        m[1].role === "assistant" && call?.type === "tool_use" && call.name === "load_profile" &&
        m[2].role === "user" && m[2].content?.[0]?.type === "tool_result" &&
        m[2].content[0].tool_use_id === call.id && m[2].content[0].content.includes("home airport SFO"),
    );
    const listed = first?.tools.find((t) => t.name === "load_profile");
    check(
      "init stays in the model's tool list, saying it has already run",
      !!listed && /ran automatically at the start/.test(listed.description),
    );
    check(
      "the transcript shows init as a tool, after the user's message",
      r.events.findIndex((e) => e.type === "block_start" && e.block.kind === "user") <
        r.events.findIndex((e) => e.type === "block_start" && e.block.kind === "tool" && e.block.name === "load_profile"),
    );
  }

  // ── once per conversation
  {
    seen.length = 0;
    await request(id, say("and again"));
    check("a later message does not run init again", runs === 1 && seen.length === 1);
  }

  // ── the model asking for it again gets "already ran", and it does not run
  {
    seen.length = 0;
    callNext = "load_profile";
    await request(id, say("reload my profile"));
    const result = seen[1]?.messages.at(-1)?.content?.[0];
    check(
      "a repeat call from the model is refused without running",
      runs === 1 && result?.type === "tool_result" && /already ran at the start/.test(result.content),
    );
  }

  // ── failure refuses the request and records nothing; the next message retries
  {
    runs = 0;
    seen.length = 0;
    behaviour = "throw";
    const r = await request(undefined, say("hi"));
    const saved = await store.loadConversation(r.c.id);
    saved.leaseUntil = null;
    await store.saveConversation(saved);
    check(
      "an init that throws refuses the request before the model runs",
      /initialisation failed: profile service unavailable/.test(r.error?.message ?? "") && seen.length === 0,
    );
    check("…and records nothing, not even the user's message", saved.messages.length === 0);

    // failing after a surface is already out: that surface is not recorded
    // either, and the conversation is left as the route found it
    behaviour = "show-then-throw";
    const shown = await request(undefined, say("hi"));
    const left = await store.loadConversation(shown.c.id);
    left.leaseUntil = null;
    await store.saveConversation(left);
    check(
      "a start refused after init showed a surface leaves the conversation as it found it",
      /initialisation failed/.test(shown.error?.message ?? "") &&
        left.messages.length === 0 && left.handles.length === 0 && left.status === "idle" && left.pending === null,
    );
    check(
      "…and the browser never receives that surface",
      !shown.events.some((e) => e.type === "ui_open" || e.type === "ui_props"),
    );
    behaviour = "ok";
    runs = 0;
    seen.length = 0;
    await request(r.c.id, say("hi again"));
    check("the next message runs init again, and the conversation starts", runs === 1 && seen.length === 1);
  }

  // ── an elicit surface from init parks the conversation before the model
  {
    runs = 0;
    seen.length = 0;
    behaviour = "pick";
    const r = await request(undefined, say("hi"));
    const parked = r.c;
    check(
      "an init that asks the user something parks before the model runs",
      seen.length === 0 && parked.status === "awaiting" && parked.pending?.handle === parked.handles[0],
    );
    behaviour = "ok";
    await request(parked.id, (c, emit) => hai.interact(c, { handle: parked.handles[0], action: "choose", value: "work" }, emit));
    const answer = seen[0]?.messages.at(-1)?.content?.[0];
    check(
      "…and the answer becomes init's result, then the model starts",
      seen.length === 1 && answer?.type === "tool_result" && answer.tool_use_id === parked.pending?.toolUseId &&
        /2 accounts/.test(answer.content) && /Chose work/.test(answer.content),
    );
  }

  // ── a surface from init reaches the browser before the model says anything
  {
    behaviour = "card";
    const r = await request(undefined, say("hi"));
    const opened = r.events.findIndex((e) => e.type === "ui_open" && e.component === "welcome");
    const status = r.events.findIndex((e) => e.type === "status" && e.status === "idle");
    check("a surface init renders is shown before the turn completes", opened >= 0 && opened < status);
    behaviour = "ok";
  }

  // ── overtaken while initialising: the fence stops it, and nothing is saved
  {
    runs = 0;
    seen.length = 0;
    const fresh = await store.loadConversation(undefined);
    fresh.leaseUntil = null;
    await store.saveConversation(fresh);
    takeover = fresh.id;
    behaviour = "slow";
    const r = await request(fresh.id, say("hi"));
    behaviour = "ok";
    const after = await store.loadConversation(fresh.id);
    after.leaseUntil = null;
    await store.saveConversation(after);
    check(
      "an init overtaken mid-flight stops at the fence and records nothing",
      isStaleLease(r.error) && seen.length === 0 && after.messages.length === 0,
    );
  }

  // ── the same, for an init that only returns text: it has no fenced write of
  // its own, so the commit after it is what keeps the model from running
  {
    runs = 0;
    seen.length = 0;
    const fresh = await store.loadConversation(undefined);
    fresh.leaseUntil = null;
    await store.saveConversation(fresh);
    takeover = fresh.id;
    behaviour = "slow-text";
    const r = await request(fresh.id, say("hi"));
    behaviour = "ok";
    const after = await store.loadConversation(fresh.id);
    after.leaseUntil = null;
    await store.saveConversation(after);
    check(
      "a text-only init overtaken mid-flight stops before the model runs",
      isStaleLease(r.error) && runs === 1 && seen.length === 0 && after.messages.length === 0,
    );
  }

  // ── started before any input: init runs, the model does not
  {
    runs = 0;
    seen.length = 0;
    behaviour = "ok";
    const r = await request(undefined, (c, emit) => hai.start(c, emit));
    const opened = r.c;
    const m = opened.messages;
    check(
      "start() runs init before anything is typed, without calling the model",
      runs === 1 && seen.length === 0 && !r.error && opened.status === "idle",
    );
    check(
      "…opening the history with a framework marker, then init's call and result",
      m.length === 3 && m[0].role === "user" && m[0].content === "[conversation started]" &&
        m[1].content?.[0]?.name === "load_profile" && m[2].content?.[0]?.type === "tool_result",
    );
    check(
      "…and shows init in the transcript without inventing a user message",
      !r.events.some((e) => e.type === "block_start" && e.block.kind === "user") &&
        r.events.some((e) => e.type === "block_start" && e.block.kind === "tool" && e.block.name === "load_profile"),
    );
    await request(opened.id, (c, emit) => hai.start(c, emit));
    check("a second start() does nothing", runs === 1 && seen.length === 0);
    await request(opened.id, say("greet me"));
    const first = seen[0]?.messages ?? [];
    check(
      "the first message then reaches the model after init, without running init again",
      runs === 1 && seen.length === 1 && first.length === 4 &&
        first[0].content === "[conversation started]" && first.at(-1).content === "greet me",
    );
  }

  // ── an init picker before any input: answering it lets the model reply
  {
    runs = 0;
    seen.length = 0;
    behaviour = "pick";
    const r = await request(undefined, (c, emit) => hai.start(c, emit));
    behaviour = "ok";
    const parked = r.c;
    check(
      "start() with an init picker parks before anything is typed",
      seen.length === 0 && parked.status === "awaiting" && parked.messages[0]?.content === "[conversation started]",
    );
    await request(parked.id, (c, emit) => hai.interact(c, { handle: parked.handles[0], action: "choose", value: "work" }, emit));
    const answered = seen[0]?.messages.at(-1)?.content?.[0];
    check(
      "…and answering it lets the model reply",
      seen.length === 1 && answered?.type === "tool_result" && /Chose work/.test(answered.content),
    );
  }

  // ── an init that asks and returns something else still waits on the question
  {
    behaviour = "pick-then-note";
    const r = await request(undefined, (c, emit) => hai.start(c, emit));
    behaviour = "ok";
    check(
      "an init that asks, then returns text, waits under the question's digest with its text after",
      r.c.status === "awaiting" && r.c.pending?.handle === r.c.handles[0] &&
        r.c.pending.digest === "2 accounts: personal, work\nProfile loaded.",
    );
  }

  // ── a failed start records nothing, and the first message runs init instead
  {
    runs = 0;
    seen.length = 0;
    behaviour = "throw";
    const r = await request(undefined, (c, emit) => hai.start(c, emit));
    behaviour = "ok";
    const saved = await store.loadConversation(r.c.id);
    saved.leaseUntil = null;
    await store.saveConversation(saved);
    check(
      "a start whose init throws is refused and records nothing",
      /initialisation failed/.test(r.error?.message ?? "") && saved.messages.length === 0 && seen.length === 0,
    );
    await request(r.c.id, say("hi"));
    check(
      "…and the first message runs init instead",
      runs === 2 && seen.length === 1 && seen[0].messages[0].content === "hi",
    );
  }

  // ── without an init tool, start() does nothing
  {
    const plain = createHai({ model, store, tools: [], surfaces: [], system: "x" });
    const r = await request(undefined, (c, emit) => plain.start(c, emit));
    check(
      "start() without an init tool quietly does nothing",
      !r.error && r.c.messages.length === 0 && r.events.length === 0,
    );
  }

  // ── over HTTP
  {
    const http = await import("node:http");
    const { nodeHandler } = await import("../packages/server/dist/index.js");
    let loads = 0;
    const counting = {
      ...store,
      loadConversation: (id) => {
        loads++;
        return store.loadConversation(id);
      },
    };
    const serve = async (runtime, path, body) => {
      const handler = nodeHandler(runtime, "/hai");
      const server = http.createServer(async (req, res) => {
        if (!(await handler(req, res))) res.writeHead(404).end();
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/hai${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: res.status, text: await res.text() };
      } finally {
        server.close();
      }
    };
    runs = 0;
    loads = 0;
    behaviour = "ok";
    const withInit = createHai({ model, store: counting, tools: [], surfaces: [picker, card], system: "x", init });
    const a = await serve(withInit, "/start", {});
    check(
      "POST /start opens a conversation, runs init, and streams it",
      a.status === 200 && a.text.includes('"type":"hello"') && a.text.includes('"name":"load_profile"') &&
        runs === 1 && loads === 1,
    );
    loads = 0;
    const without = createHai({ model, store: counting, tools: [], surfaces: [], system: "x" });
    const b = await serve(without, "/start", {});
    check(
      "POST /start without an init tool creates no conversation",
      b.status === 200 && b.text === "" && loads === 0,
    );

    // ── the client's start() tries again after init threw, and stops once it ran.
    // `hello` has already given it a conversation id by then, so the id alone
    // cannot be what stops it.
    const { createChat } = await import("../packages/client/src/index.js");
    const handler = nodeHandler(withInit, "/hai");
    const server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const chat = createChat({ endpoint: `http://127.0.0.1:${server.address().port}/hai`, registry: {} });
      runs = 0;
      behaviour = "throw";
      await chat.start();
      const opened = chat.state.conversationId;
      const refused = chat.state.blocks.some((b) => b.kind === "error" && /initialisation failed/.test(b.message));
      behaviour = "ok";
      await chat.start();
      check(
        "start() after an init that threw tries again, in the same conversation",
        refused && opened && runs === 2 && chat.state.conversationId === opened &&
          chat.state.context.messages[0]?.content === "[conversation started]",
      );
      loads = 0;
      const again = await chat.start();
      check("…and once init has run, start() sends nothing", again === false && loads === 0 && runs === 2);
    } finally {
      server.close();
    }
  }

  // ── a name the model could confuse is refused up front
  {
    const clash = (tools) => {
      try {
        createHai({ model, store, tools, surfaces: [], system: "x", init });
        return false;
      } catch (err) {
        return /same name as another tool/.test(err.message);
      }
    };
    const twin = defineTool({ name: "load_profile", description: "d", input: any, inputJsonSchema: { type: "object" }, run: () => ({ model: "" }) });
    const queryUi = defineTool({ ...init, name: "query_ui" });
    check("an init named like another tool, or query_ui, is refused", clash([twin]) && (() => {
      try {
        createHai({ model, store, tools: [], surfaces: [], system: "x", init: queryUi });
        return false;
      } catch (err) {
        return /same name as another tool/.test(err.message);
      }
    })());
  }
}

// ── action handlers may be async, and may write ──────────────────────────
// So a click the runtime refuses up front — not the one the turn is waiting
// for — never reaches its handler, and an accepted click is saved before the
// model runs. That makes a handler run at least once per recorded click, not
// exactly once: if the click's save is refused or fails after the handler has
// run, nothing is recorded, and clicking again runs it again.
async function actionChecks(make) {
  console.log("\naction handlers");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool, resolve, inform, isStaleLease } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make({ leaseMs: 40 });
  const tick = () => new Promise((r) => setTimeout(r, 5));

  let behaviour = "ok"; // what the picker's handler does next: ok | throw | slow
  const calls = []; // every handler run: { action, value, handle, conversationId }
  const picker = defineSurface({ name: "seats", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} })
    .implement({
      digest: () => "3 seats",
      actions: {
        async choose(v, ctx) {
          calls.push({ action: "choose", value: v, handle: ctx.handle, conversationId: ctx.conversationId });
          await tick();
          if (behaviour === "throw") throw new Error("seat taken");
          if (behaviour === "slow") {
            await new Promise((r) => setTimeout(r, 70)); // outlives the 40ms lease
            const winner = await store.loadConversation(ctx.conversationId);
            winner.leaseUntil = null;
            await store.saveConversation(winner);
          }
          return `Booked seat ${v}.`;
        },
      },
      queries: {},
    });
  // shown for display, but it declares a resolve too: nothing ever waits on it
  const card = defineSurface({ name: "trip", version: 1, props: any, actions: { hold: resolve(any), note: inform(any) }, queries: {} })
    .implement({
      digest: () => "trip card",
      actions: {
        async hold(v) {
          calls.push({ action: "hold", value: v });
          return `Held ${v}.`;
        },
        async note(v) {
          calls.push({ action: "note", value: v });
          await tick();
          return `Noted ${v}.`;
        },
      },
      queries: {},
    });
  const show = defineTool({
    name: "show",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    run: (i, ctx) => (i.kind === "seats" ? ctx.render(picker, {}, { mode: "elicit" }) : ctx.render(card, {})),
  });

  // the model shows whatever is queued next, one per request, then answers
  const seen = [];
  const next = [];
  const model = {
    id: "stub",
    async generate(req) {
      seen.push(JSON.parse(JSON.stringify(req.messages)));
      const kind = next.shift();
      if (kind) return { content: [{ type: "tool_use", id: `tu_${seen.length}`, name: "show", input: { kind } }], stop_reason: "tool_use" };
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const hai = createHai({ model, store, tools: [show], surfaces: [picker, card], system: "x" });

  async function request(id, act) {
    const c = await store.loadConversation(id);
    const events = [];
    let error = null;
    try {
      await act(c, (e) => events.push(e));
    } catch (err) {
      error = err;
    }
    c.leaseUntil = null;
    // like the route: a save that finds the turn overtaken is its outcome
    if (!isStaleLease(error)) {
      try {
        await store.saveConversation(c);
      } catch (err) {
        if (!isStaleLease(err)) throw err;
        error = err;
      }
    }
    return { c, events, error };
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);
  const click = (handle, action, value) => (c, emit) => hai.interact(c, { handle, action, value }, emit);

  next.push("trip");
  const opened = await request(undefined, say("plan my trip"));
  const id = opened.c.id;
  const cardHandle = opened.c.handles[0];
  next.push("seats");
  const parked = await request(id, say("pick a seat"));
  const seatHandle = parked.c.handles[1];
  const before = { messages: parked.c.messages.length, models: seen.length };

  // ── only the click the turn is waiting for reaches a handler
  {
    calls.length = 0;
    const hold = await request(id, click(cardHandle, "hold", "4A"));
    const note = await request(id, click(cardHandle, "note", "window please"));
    check(
      "a resolve on a surface nobody is waiting on is refused before its handler runs",
      hold.error?.message === "nothing awaiting this handle" && !calls.some((c) => c.action === "hold"),
    );
    check(
      "an inform click while a question waits is refused before its handler runs",
      note.error?.message === "a question is waiting to be answered first" && !calls.some((c) => c.action === "note"),
    );
    check(
      "…and neither touches the history or the model",
      note.c.messages.length === before.messages && note.c.pending?.handle === seatHandle && seen.length === before.models,
    );
  }

  // ── a handler that throws refuses the click
  {
    calls.length = 0;
    behaviour = "throw";
    const r = await request(id, click(seatHandle, "choose", "4A"));
    behaviour = "ok";
    check(
      "a handler that throws refuses the click: nothing recorded, the surface still live",
      r.error?.message === "action failed: seat taken" && calls.length === 1 &&
        r.c.pending?.handle === seatHandle && !r.c.frozen.includes(seatHandle) &&
        r.c.messages.length === before.messages && seen.length === before.models &&
        !r.events.some((e) => e.type === "ui_state" || (e.type === "block_start" && e.block.kind === "interaction")),
    );
  }

  // ── an async handler is awaited, and knows where it is
  {
    calls.length = 0;
    const r = await request(id, click(seatHandle, "choose", "4A"));
    const answer = seen.at(-1)?.at(-1)?.content?.[0];
    check(
      "an async handler is awaited: its label answers the question and reaches the transcript",
      !r.error && answer?.type === "tool_result" && answer.content === "3 seats\nBooked seat 4A." &&
        r.events.some((e) => e.type === "block_start" && e.block.kind === "interaction" && e.block.label === "Booked seat 4A."),
    );
    check(
      "the handler is told the conversation and the handle",
      calls.length === 1 && calls[0].conversationId === id && calls[0].handle === seatHandle,
    );
  }

  // ── with nothing waiting, an inform click runs its async handler
  {
    calls.length = 0;
    const r = await request(id, click(cardHandle, "note", "window please"));
    check(
      "an inform click with nothing waiting runs its handler and tells the model",
      !r.error && calls.length === 1 && r.c.messages.some((m) => m.content === "[UI interaction] Noted window please."),
    );
  }

  // ── the handler can still run twice for one click: once for a click whose
  // save is refused, and again when the user clicks again
  next.push("seats");
  const again = await request(id, say("and the way back"));
  const back = again.c.handles.at(-1);
  const models = seen.length;

  // a newer request takes over while the handler runs: the click's save trips,
  // and the model never runs
  {
    calls.length = 0;
    behaviour = "slow";
    const r = await request(id, click(back, "choose", "9C"));
    behaviour = "ok";
    check(
      "a click whose request was taken over while its handler ran is refused at its save, before the model runs",
      isStaleLease(r.error) && calls.length === 1 && seen.length === models,
    );
  }

  // a save that simply fails: the route saves again on the way out, to release
  // the lease, and that save must not record the click the browser saw fail
  {
    let failSave = false;
    const flaky = {
      ...store,
      saveConversation(c) {
        if (!failSave) return store.saveConversation(c);
        failSave = false;
        return Promise.reject(new Error("connection reset"));
      },
    };
    const flakyHai = createHai({ model, store: flaky, tools: [show], surfaces: [picker, card], system: "x" });
    calls.length = 0;
    failSave = true;
    const r = await request(id, (c, emit) => flakyHai.interact(c, { handle: back, action: "choose", value: "9C" }, emit));
    const kept = await store.loadConversation(id);
    kept.leaseUntil = null;
    await store.saveConversation(kept);
    check(
      "a click whose save fails is undone, so the route's own save cannot record it",
      r.error?.message === "connection reset" && calls.length === 1 && seen.length === models &&
        kept.pending?.handle === back && kept.status === "awaiting" && !kept.frozen.includes(back) &&
        kept.messages.length === again.c.messages.length,
    );
    const retry = await request(id, click(back, "choose", "9C"));
    check(
      "…and clicking again runs the handler again, and counts",
      !retry.error && calls.length === 2 && retry.c.frozen.includes(back) && seen.length === models + 1,
    );
  }
}

// ── one question per reply ───────────────────────────────────────────────
// A model reply can make several tool calls, and Claude makes parallel ones on
// its own. The turn parks on one surface, so a second elicit surface in the
// same reply would be shown live with no way to answer it, and its tool_use
// would never get a tool_result — which the Messages API refuses from then on.
async function oneQuestionChecks(make) {
  console.log("\none question per reply");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool, resolve, isStaleLease, StaleLease } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make({ leaseMs: 40 });

  // props without `what` fail validation, so a render can fail before it shows
  const what = {
    parse(v) {
      if (!v?.what) throw new Error("what is required");
      return v;
    },
  };
  const confirm = defineSurface({ name: "confirm", version: 1, props: what, actions: { ok: resolve(any) }, queries: {} })
    .implement({ digest: (p, { handle }) => `Confirm ${p.what} on ${handle}.`, actions: { ok: (_v, { props }) => `Confirmed ${props.what}.` }, queries: {} });
  const note = defineSurface({ name: "note", version: 1, props: any, actions: {}, queries: {} })
    .implement({ digest: () => "a note", actions: {}, queries: {} });
  // stored, then its digest throws, so it is never shown
  const broken = defineSurface({ name: "broken", version: 1, props: any, actions: { ok: resolve(any) }, queries: {} })
    .implement({ digest: () => { throw new Error("digest broke"); }, actions: { ok: () => "ok" }, queries: {}, staleAfterMs: 60_000 });
  const tool = (name, run) => defineTool({ name, description: "d", input: any, inputJsonSchema: { type: "object" }, run });
  const ask = (ctx, what) => ctx.render(confirm, { what }, { mode: "elicit" });
  const tools = [
    tool("ask", (i, ctx) => ask(ctx, i.what)),
    tool("show", (_i, ctx) => ctx.render(note, {})),
    // one call asking twice, and returning what the second render gave back
    tool("ask_twice", async (_i, ctx) => {
      await ask(ctx, "A");
      return ask(ctx, "B");
    }),
    // asks, then fails
    tool("ask_then_fail", async (_i, ctx) => {
      await ask(ctx, "F");
      throw new Error("rate service down");
    }),
    // two renders started at once, before either is stored
    tool("ask_at_once", async (_i, ctx) => {
      const [p, q] = await Promise.all([ask(ctx, "P"), ask(ctx, "Q")]);
      toldAtOnce = q.model;
      return p;
    }),
    // a render that fails validation, then one that doesn't
    tool("ask_bad_then_ask", async (_i, ctx) => {
      await ask(ctx, undefined).catch(() => {});
      return ask(ctx, "R");
    }),
    // the same, started at once: the second waits on the first, which fails
    tool("ask_bad_and_ask_at_once", async (_i, ctx) => {
      const [, s] = await Promise.all([ask(ctx, undefined).catch(() => {}), ask(ctx, "S")]);
      return s;
    }),
    // a surface stored and then never shown, then a question that is
    tool("ask_broken_then_ask", async (_i, ctx) => {
      await ctx.render(broken, {}, { mode: "elicit" }).catch(() => {});
      return ask(ctx, "T");
    }),
    // fails while its question is still being stored
    tool("ask_and_fail_at_once", async (_i, ctx) => {
      await Promise.all([ask(ctx, "U"), Promise.reject(new Error("quote failed"))]);
    }),
    // asks without waiting for it, and returns
    tool("ask_unawaited", (_i, ctx) => {
      ask(ctx, "W");
      return ctx.text("Asked.");
    }),
    // asks after it has returned
    tool("ask_late", (_i, ctx) => {
      setTimeout(() => ask(ctx, "L").then((r) => (toldLate = r.model)), 5);
      return ctx.text("Will ask.");
    }),
    // returns with a slow render still storing, and asks while it does
    tool("ask_while_storing", (_i, ctx) => {
      ctx.render(note, {});
      setTimeout(() => ask(ctx, "D").then((r) => (toldWhileStoring = r.model)), 5);
      return ctx.text("Will ask.");
    }),
    // shows something without waiting for it
    tool("show_unawaited", (_i, ctx) => {
      ctx.render(note, {});
      return ctx.text("Shown.");
    }),
  ];
  let toldLate = "";
  let toldWhileStoring = "";
  let toldAtOnce = "";

  // the model makes whatever calls are queued next, all in one reply
  const seen = [];
  const next = [];
  let n = 0;
  const model = {
    id: "stub",
    async generate(req) {
      seen.push(JSON.parse(JSON.stringify(req.messages)));
      const calls = next.shift();
      if (!calls) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
      return {
        content: calls.map(([name, input]) => ({ type: "tool_use", id: `tu_${++n}`, name, input: input ?? {} })),
        stop_reason: "tool_use",
      };
    },
  };
  const hai = createHai({ model, store, tools, surfaces: [confirm, note, broken], system: "x" });
  // the same, with a payload write slow enough for a tool to fail during it
  const slowStore = {
    ...store,
    async putPayload(...args) {
      await new Promise((r) => setTimeout(r, 20));
      return store.putPayload(...args);
    },
  };
  const slowHai = createHai({ model, store: slowStore, tools, surfaces: [confirm, note, broken], system: "x" });
  // …and one whose payload writes find the conversation taken over
  const lostStore = {
    ...store,
    async putPayload(record) {
      throw new StaleLease(record.conversationId);
    },
  };
  const lostHai = createHai({ model, store: lostStore, tools, surfaces: [confirm, note, broken], system: "x" });

  async function request(id, act) {
    const c = await store.loadConversation(id);
    const events = [];
    let error = null;
    try {
      await act(c, (e) => events.push(e));
    } catch (err) {
      error = err;
    }
    c.leaseUntil = null;
    if (!isStaleLease(error)) await store.saveConversation(c);
    return { c, events, error };
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);
  const click = (handle) => (c, emit) => hai.interact(c, { handle, action: "ok", value: {} }, emit);
  // every tool_use in the history the model was last sent, less those answered
  const unanswered = (messages) => {
    const blocks = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const answered = new Set(blocks.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
    return blocks.filter((b) => b.type === "tool_use" && !answered.has(b.id)).map((b) => b.id);
  };
  const resultOf = (messages, id) =>
    messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.tool_use_id === id)?.content;
  const opened = (events) => events.filter((e) => e.type === "ui_open");
  // the result the transcript shows for a response's i-th tool call
  const shownResult = (events, i) => {
    const id = events.filter((e) => e.type === "block_start" && e.block.kind === "tool")[i]?.block.id;
    return events.find((e) => e.type === "block_update" && e.id === id)?.result;
  };

  // ── two questions and a display surface in one reply
  {
    next.push([["ask", { what: "A" }], ["show"], ["ask", { what: "B" }]]);
    const r = await request(undefined, say("set it every weekend"));
    const [first, card] = opened(r.events);
    const refusal = shownResult(r.events, 2);
    check(
      "only the first question is shown; a display surface in the same reply still is",
      opened(r.events).length === 2 && first?.mode === "elicit" && card?.mode === "display" &&
        r.c.handles.length === 2 && r.c.pending?.handle === first.handle && r.c.pending.toolUseId === "tu_1",
    );
    check(
      "the second question's call is told it wasn't shown, and why",
      refusal === `Not shown: ${first.handle} is already waiting for the user. Ask this again after it is answered.`,
    );
    const answered = await request(r.c.id, click(first.handle));
    const sent = seen.at(-1);
    check(
      "answering the first sends a result for every call in that reply",
      !answered.error && unanswered(sent).length === 0 && /^Not shown: /.test(resultOf(sent, "tu_3")) &&
        /Confirmed A\./.test(resultOf(sent, "tu_1")),
    );
  }

  // ── typing instead of answering also answers every call
  {
    next.push([["ask", { what: "C" }], ["ask", { what: "D" }]]);
    const r = await request(undefined, say("two more"));
    await request(r.c.id, say("never mind"));
    check(
      "typing over the question answers every call in that reply too",
      opened(r.events).length === 1 && unanswered(seen.at(-1)).length === 0,
    );
  }

  // ── the next reply may ask again
  {
    next.push([["ask", { what: "E" }], ["ask", { what: "G" }]]);
    const r = await request(undefined, say("E and G"));
    next.push([["ask", { what: "G" }]]);
    const again = await request(r.c.id, click(opened(r.events)[0].handle));
    const g = opened(again.events)[0];
    check(
      "after the answer, the model's next reply can ask the refused question",
      g?.mode === "elicit" && again.c.pending?.handle === g.handle,
    );
  }

  // ── one call asking twice: the turn waits on what it showed, not what it returned
  {
    next.push([["ask_twice"]]);
    const r = await request(undefined, say("ask twice"));
    const [shown] = opened(r.events);
    check(
      "a call that asks twice shows the first, and the turn waits on it",
      opened(r.events).length === 1 && r.c.pending?.handle === shown?.handle,
    );
    const answered = await request(r.c.id, click(shown.handle));
    check(
      "…and its answer goes out under the first's digest, with the refusal after it",
      !answered.error &&
        resultOf(seen.at(-1), r.c.pending.toolUseId) ===
          `Confirm A on ${shown.handle}.\nNot shown: ${shown.handle} is already waiting for the user. ` +
            `Ask this again after it is answered.\nConfirmed A.`,
    );
  }

  // ── two renders at once: the first claims the question before either is stored
  {
    next.push([["ask_at_once"]]);
    const r = await request(undefined, say("both at once"));
    const [shown] = opened(r.events);
    check(
      "two questions rendered at once show one, and the turn waits on it",
      opened(r.events).length === 1 && r.c.handles.length === 1 && r.c.pending?.handle === shown?.handle &&
        toldAtOnce === `Not shown: ${shown?.handle} is already waiting for the user. Ask this again after it is answered.`,
    );
  }

  // ── …and if the first of them fails, the other one asks
  {
    next.push([["ask_bad_and_ask_at_once"]]);
    const r = await request(undefined, say("both at once, one bad"));
    const [shown] = opened(r.events);
    check(
      "two questions rendered at once, the first failing, show the second",
      opened(r.events).length === 1 && r.c.pending?.handle === shown?.handle && /^Confirm S on /.test(r.c.pending.digest),
    );
  }

  // ── a surface whose digest throws is never shown, and never counts
  {
    next.push([["ask_broken_then_ask"]]);
    const r = await request(undefined, say("broken first"));
    const [shown] = opened(r.events);
    check(
      "a question whose digest throws isn't recorded, and the next one asks",
      opened(r.events).length === 1 && r.c.handles.length === 1 && r.c.handles[0] === shown?.handle &&
        r.c.pending?.handle === shown.handle && /^Confirm T on /.test(r.c.pending.digest),
    );
  }

  // ── a render that fails before it shows gives the question back
  {
    next.push([["ask_bad_then_ask"]]);
    const r = await request(undefined, say("try twice"));
    const [shown] = opened(r.events);
    check(
      "a question that fails validation doesn't stop the next one being asked",
      opened(r.events).length === 1 && r.c.pending?.handle === shown?.handle && /^Confirm R on /.test(r.c.pending.digest),
    );
  }

  // ── a tool that fails while its question is still being stored
  {
    next.push([["ask_and_fail_at_once"], ["ask", { what: "V" }]]);
    const r = await request(undefined, (c, emit) => slowHai.send(c, "fail mid-store", emit));
    const [withdrawn, asked] = opened(r.events);
    check(
      "a tool that fails while its question is being stored has it withdrawn once stored",
      withdrawn?.mode === "elicit" && r.c.frozen.includes(withdrawn.handle) &&
        r.events.some((e) => e.type === "ui_state" && e.handle === withdrawn.handle && e.state === "frozen"),
    );
    check(
      "…and a later call in that reply asks instead",
      asked?.mode === "elicit" && r.c.pending?.handle === asked.handle && /^Confirm V on /.test(r.c.pending.digest),
    );
  }

  // ── a render the tool didn't wait for is still the question
  {
    next.push([["ask_unawaited"]]);
    const r = await request(undefined, (c, emit) => slowHai.send(c, "don't wait", emit));
    const [shown] = opened(r.events);
    check(
      "a question the tool didn't wait for is waited on, under its digest",
      shown && r.c.pending?.handle === shown.handle && r.c.pending.digest === `Confirm W on ${shown.handle}.\nAsked.`,
    );
  }

  // ── once the tool is done, it can't ask
  {
    next.push([["ask_late"]]);
    const r = await request(undefined, say("ask later"));
    await new Promise((res) => setTimeout(res, 30));
    check(
      "a render after the tool has returned shows nothing",
      opened(r.events).length === 0 && r.c.pending === null && toldLate === "Not shown: the tool had already finished.",
    );
  }

  // ── …nor while the renders it already started are still storing
  {
    next.push([["ask_while_storing"]]);
    const r = await request(undefined, (c, emit) => slowHai.send(c, "ask while storing", emit));
    check(
      "a render the tool schedules while its others finish storing shows nothing",
      !opened(r.events).some((e) => e.mode === "elicit") && r.c.pending === null &&
        toldWhileStoring === "Not shown: the tool had already finished.",
    );
  }

  // ── a render the tool didn't wait for that lost the lease still stops the turn
  {
    next.push([["show_unawaited"]]);
    const models = seen.length;
    const r = await request(undefined, (c, emit) => lostHai.send(c, "show it", emit));
    check(
      "a lost lease in a render the tool didn't wait for stops the turn",
      isStaleLease(r.error) && seen.length === models + 1,
    );
  }

  // ── a call that asks and then fails withdraws its question
  {
    next.push([["ask_then_fail"], ["ask", { what: "H" }]]);
    const r = await request(undefined, say("try it"));
    const [withdrawn, asked] = opened(r.events);
    check(
      "a call that asks and then fails has its question withdrawn",
      r.c.frozen.includes(withdrawn?.handle) &&
        r.events.some((e) => e.type === "ui_state" && e.handle === withdrawn?.handle && e.state === "frozen"),
    );
    check(
      "…so a later call in that reply can ask instead",
      asked?.mode === "elicit" && r.c.pending?.handle === asked.handle && r.c.pending.toolUseId === `tu_${n}`,
    );
  }
}

// ── the transcript follows new content, and keeps a reader's place ──────
// Surfaces mount a microtask after the render that creates them, and only then
// have height. A transcript that scrolls before that, or decides whether to
// follow from the geometry it sees, stops following at its first tall surface.
async function transcriptChecks() {
  console.log("\ntranscript");

  // Just enough DOM for the renderer: every element has a height, and the root
  // scrolls. Reading scrollTop clamps it to the content, as a layout does, and
  // a move is reported by a scroll event at the next frame, as a browser does.
  class El {
    constructor(tag) {
      Object.assign(this, { tagName: tag, children: [], dataset: {}, className: "", textContent: "", own: 20 });
      Object.assign(this, { nodeType: 1, parentNode: null, moves: 0 });
    }
    // take a node from wherever it is; one that was already placed has moved
    adopt(node) {
      if (node.parentNode) {
        node.remove();
        node.moves++;
      }
      node.parentNode = this;
    }
    append(...nodes) {
      for (const node of nodes) {
        this.adopt(node);
        this.children.push(node);
      }
    }
    insertBefore(node, ref) {
      this.adopt(node);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(node);
      else this.children.splice(i, 0, node);
    }
    replaceChildren(...nodes) {
      // every child comes out first, so one put straight back has moved too
      for (const child of [...this.children]) child.remove();
      for (const node of nodes) if (node.wasIn === this) node.moves++;
      this.append(...nodes);
    }
    remove() {
      const parent = this.parentNode;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1);
      Object.assign(this, { parentNode: null, wasIn: parent });
    }
    get firstChild() {
      return this.children[0] ?? null;
    }
    get nextSibling() {
      const siblings = this.parentNode?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    get height() {
      return this.own + this.children.reduce((sum, c) => sum + c.height, 0);
    }
    // icons and ARIA: attributes the renderer sets and nothing here reads
    setAttribute() {}
  }
  // whitespace in the page's markup, say
  class Text extends El {
    constructor() {
      super("#text");
      Object.assign(this, { nodeType: 3, own: 0 });
    }
  }
  class Root extends El {
    constructor() {
      super("div");
      Object.assign(this, { own: 0, clientHeight: 600, top: 0, listeners: [] });
    }
    get scrollHeight() {
      return Math.max(this.clientHeight, this.height);
    }
    get scrollTop() {
      const top = Math.max(0, Math.min(this.top, this.scrollHeight - this.clientHeight));
      if (top !== this.top) Object.assign(this, { top, moved: true });
      return top;
    }
    set scrollTop(y) {
      if (y !== this.top) Object.assign(this, { top: y, moved: true });
      void this.scrollTop;
    }
    addEventListener(type, fn) {
      if (type === "scroll") this.listeners.push(fn);
    }
    removeEventListener(type, fn) {
      if (type === "scroll") this.listeners = this.listeners.filter((f) => f !== fn);
    }
    // a rendering step: one scroll event for whatever moved since the last
    frame() {
      if (!this.moved) return;
      this.moved = false;
      for (const fn of this.listeners) fn();
    }
    // the reader scrolling: the position moves, then the browser says so
    scrollByReader(y) {
      this.scrollTop = y;
      this.frame();
    }
    get fromBottom() {
      return this.scrollHeight - this.scrollTop - this.clientHeight;
    }
  }
  // Resize observations are delivered when a test says a frame has laid out,
  // for the observed elements whose box changed: the root's is its viewport,
  // which content growing inside it doesn't change.
  const size = (el) => el.clientHeight ?? el.height;
  const observers = [];
  class ResizeObserver {
    constructor(callback) {
      Object.assign(this, { callback, targets: new Map() });
      observers.push(this);
    }
    // as in a browser, only elements can be observed
    observe(el) {
      if (el.nodeType !== 1) throw new TypeError("parameter 1 is not of type 'Element'");
      this.targets.set(el, size(el));
    }
    unobserve(el) {
      if (el.nodeType !== 1) throw new TypeError("parameter 1 is not of type 'Element'");
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  const laidOut = () => {
    for (const o of observers) {
      const changed = [...o.targets].filter(([el, seen]) => size(el) !== seen);
      for (const [el] of changed) o.targets.set(el, size(el));
      if (changed.length) o.callback(changed.map(([target]) => ({ target })));
    }
  };
  const hadDocument = "document" in globalThis;
  const hadObserver = "ResizeObserver" in globalThis;
  globalThis.document ??= { createElement: (tag) => new El(tag), createElementNS: (ns, tag) => new El(tag) };
  globalThis.ResizeObserver ??= ResizeObserver;

  try {
    const { renderTranscript, closeTranscript } = await import("../packages/client/src/transcript.js");
    let n = 0;
    const heights = new Map();
    const mounts = new Map();
    const chat = {
      state: { blocks: [], surfaces: new Map() },
      // a tall surface, with its height only once it has mounted
      mount(handle, el) {
        mounts.set(handle, (mounts.get(handle) ?? 0) + 1);
        el.own = heights.get(handle) ?? 800;
      },
    };
    const message = () => ({ kind: "user", id: `b${++n}`, text: "hi" });
    const surface = () => {
      const handle = `ui_${++n}`;
      chat.state.surfaces.set(handle, { props: {} });
      return { kind: "ui", id: `ui:${handle}`, handle };
    };
    const root = new Root();
    const render = () => renderTranscript(root, chat);
    const settled = () => new Promise((r) => setTimeout(r, 0));

    chat.state.blocks.push(message(), surface());
    render();
    await settled();
    check("a tall surface is in view once it has mounted", root.scrollTop > 0 && root.fromBottom === 0);

    chat.state.blocks.push(message(), surface());
    render();
    await settled();
    check("…and the transcript goes on following after it", root.fromBottom === 0);

    // one chunk of the stream renders twice before anything in it mounts
    root.scrollByReader(100);
    chat.state.blocks.push(message(), surface());
    render();
    render();
    await settled();
    check("a reader who scrolled up keeps their place through a turn", root.scrollTop === 100 && root.fromBottom > 0);

    root.scrollByReader(root.scrollHeight);
    chat.state.blocks.push(message(), surface());
    render();
    await settled();
    check("scrolling back to the bottom follows again", root.fromBottom === 0);

    // content grows between the transcript's own scroll and the frame that
    // reports it, as an image loading in a surface would
    heights.set(chat.state.blocks.at(-1).handle, 1100);
    root.children.at(-1).own = 1100;
    root.frame();
    render();
    await settled();
    check("content growing before its own scroll is reported doesn't stop it following", root.fromBottom === 0);

    // a surface grows after it has mounted, with no render to follow it
    const grow = (by) => {
      const last = chat.state.blocks.at(-1).handle;
      heights.set(last, (heights.get(last) ?? 800) + by);
      root.children.at(-1).own += by;
      laidOut();
    };
    grow(200);
    check("a surface that grows after mounting stays in view without another render", root.fromBottom === 0);
    root.scrollByReader(100);
    grow(200);
    check("…but a reader who scrolled up isn't pulled back down by it", root.scrollTop === 100);

    // the reader scrolls back down and then up again, and a render comes
    // before the browser has reported that last scroll
    root.scrollByReader(root.scrollHeight);
    root.scrollTop = 100;
    chat.state.blocks.push(message(), surface());
    render();
    await settled();
    root.frame();
    check("a scroll not yet reported when a render comes isn't overwritten by it", root.scrollTop === 100);

    // the model streams a reply, one render per chunk
    const before = [...root.children];
    const reply = { kind: "assistant", id: `b${++n}`, text: "" };
    chat.state.blocks.push(reply);
    for (const chunk of ["One, ", "two, ", "three."]) {
      reply.text += chunk;
      render();
      await settled();
    }
    check("each surface mounts once, however many renders follow", [...mounts.values()].every((count) => count === 1));
    check(
      "a block that hasn't changed keeps its element, never taken out and put back",
      before.every((el, i) => root.children[i] === el && el.moves === 0),
    );

    // a tool row the reader expanded, then its status changes
    const tool = { kind: "tool", id: `b${++n}`, name: "search", input: {}, status: "running" };
    chat.state.blocks.push(tool);
    render();
    await settled();
    const row = root.children.at(-1);
    row.open = true;
    Object.assign(tool, { status: "ok", ms: 12, result: "3 found" });
    render();
    await settled();
    check(
      "a changed block is redrawn in its place, and an expanded tool row stays expanded",
      root.children.at(-1) !== row && root.children.at(-1).open === true && root.children.length === chat.state.blocks.length &&
        !observers.some((o) => o.targets.has(row)),
    );

    // something the page put after the transcript, as mountChat's starters,
    // and whitespace, as markup leaves inside an element
    root.append(new El("div"), new Text());
    render();
    await settled();
    check("what the page added after the transcript goes at its next render", root.children.length === chat.state.blocks.length);

    // every surface at its own height again, as once its images have loaded
    const loaded = () => {
      for (const el of root.children) if (el.dataset.handle) el.own = heights.get(el.dataset.handle) ?? 800;
      laidOut();
    };

    // the content shrinks under a reader who scrolled up, the browser pulls
    // them up to the new bottom and reports it before any resize, and then the
    // content grows back
    root.scrollByReader(root.scrollHeight - root.clientHeight - 300);
    const place = root.scrollTop;
    for (const el of root.children) if (el.dataset.handle) el.own = 10;
    void root.scrollTop;
    root.frame();
    laidOut();
    loaded();
    check("content that shrinks and grows back returns the reader to their place", root.scrollTop === place);

    // a new conversation, its first render as long as the last one's
    chat.state.blocks = chat.state.blocks.map((b) => (b.kind === "ui" ? surface() : message()));
    render();
    await settled();
    check("a new conversation starts out following", root.fromBottom === 0);

    // a page that clears the transcript itself on a reset, then renders again
    const old = [...root.children];
    root.replaceChildren();
    chat.state.blocks = [];
    render();
    await settled();
    check(
      "a reset's elements stop being observed, even ones the page took out first",
      old.length > 0 && old.every((el) => !observers.some((o) => o.targets.has(el))),
    );

    closeTranscript(root);
    check(
      "a closed transcript lets go of its observer and its scroll listener",
      root.listeners.length === 0 && observers.every((o) => o.targets.size === 0),
    );
  } finally {
    if (!hadDocument) delete globalThis.document;
    if (!hadObserver) delete globalThis.ResizeObserver;
  }
}

// ── a window, when given, has to be a real one ──────────────────────────
// Leaving it out means "never". The type rules out invalid values, but
// JavaScript callers never see the type.
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
    "a zero, negative, NaN, infinite, null or misspelled window is refused",
    [0, -1, NaN, Infinity, null, "15m", "Never"].every(refused),
  );
  check(
    'a positive window, "never", and no window at all are accepted',
    !refused(1) && !refused("never") && !refused(undefined),
  );
}

// Only when invoked directly. A Postgres adapter imports `conform` to run this
// same suite against itself, and must not inherit a run or a process.exit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await conform("memoryStore", (opts) => memoryStore(opts));
  await integration("memoryStore", (opts) => memoryStore(opts));
  await routeChecks();
  await windowChecks();
  await clientChecks();
  await transcriptChecks();

  // Said plainly because a suite that looks exhaustive is worse than one that
  // admits its edges: nothing here can prove lease acquisition is atomic. This
  // process cannot interleave two acquisitions, so a read-then-write adapter
  // passes every check above and still races. Review that per adapter.
  console.log("\n  not covered: atomicity of lease acquisition or of fenced writes (single process)");

  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
