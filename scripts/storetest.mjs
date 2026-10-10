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

/**
 * What `publish` and `subscribe` promise, between a store that publishes and
 * one that hears: the same store, or two sharing a database. Exported for
 * adapters whose stores only hear with extra wiring.
 */
export async function pubsubChecks(from, to) {
  const a = await from.loadConversation(undefined);
  const b = await from.loadConversation(undefined);
  for (const c of [a, b]) {
    c.leaseUntil = null;
    await from.saveConversation(c);
  }
  const heard = [];
  const other = [];
  const listening = new AbortController();
  // resolved once listening: nothing published after this may be missed
  await to.subscribe(a.id, (m) => heard.push(m), listening.signal);
  await to.subscribe(b.id, (m) => other.push(m), listening.signal);
  const long = `${"wake turn ".repeat(2_500)}— fares, 🛫, 終わり`; // past any one NOTIFY, and not ASCII
  const sent = ["one", "two", long, "four"];
  for (const m of sent) await from.publish(a.id, m);
  const arrived = async (n) => {
    for (let i = 0; i < 100 && heard.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  };
  await arrived(sent.length);
  check("a published message reaches a subscriber, in the order published", JSON.stringify(heard.slice(0, 2)) === '["one","two"]' && heard[3] === "four");
  check(`a message far longer than one NOTIFY arrives whole (${long.length} characters, some not ASCII)`, heard[2] === long);
  check("a message for one conversation reaches no other's subscribers", other.length === 0);
  listening.abort();
  await from.publish(a.id, "after");
  await new Promise((r) => setTimeout(r, 200));
  check("a subscriber hears nothing once its signal aborts", !heard.includes("after"));
}

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

  // ── notices: appended unfenced, numbered in order, read back as given ─
  {
    const s = make();
    const a = await s.loadConversation(undefined); // a holds the lease throughout
    const b = await s.loadConversation(undefined);
    const notice = (conversationId, extra) => ({ conversationId, name: "n", version: 1, payload: { x: 1 }, model: "m", ...extra });

    check("a new conversation has taken in no notices", (a.noticedThrough ?? 0) === 0);
    check("a conversation with no notices reads as empty, not missing", JSON.stringify(await s.getNotices(a.id, 0)) === "[]");
    check("an unknown conversation's notices read as null", (await s.getNotices("conv_unknown", 0)) === null);
    let refused = false;
    try {
      await s.putNotice(notice("conv_unknown"));
    } catch {
      refused = true;
    }
    check("a notice for an unknown conversation is refused", refused);

    // unfenced: a turn holds a's lease, and the notice lands anyway
    const before = Date.now();
    const shapes = ["hello", "", 42, true, null, [1, "two"], { nested: { deep: ["x"] } }];
    const put = [];
    for (const payload of shapes) put.push(await s.putNotice(notice(a.id, { payload })));
    put.push(await s.putNotice(notice(a.id, { model: null, handle: "ui_01", replaces: "ui_00", name: "other", version: 3 })));
    put.push(await s.putNotice(notice(a.id, { kind: "wake" })));
    await s.putNotice(notice(b.id));
    const after = Date.now();
    check("a notice lands while another holds the conversation's lease", put.length === shapes.length + 2);
    check(
      "seq increases with each notice in a conversation",
      put.every((n, i) => i === 0 || n.seq > put[i - 1].seq),
    );
    const all = await s.getNotices(a.id, 0);
    check(
      "notices read back in seq order, every field as given",
      JSON.stringify(all) === JSON.stringify(put) &&
        all.slice(0, shapes.length).every((n, i) => JSON.stringify(n.payload) === JSON.stringify(shapes[i])),
    );
    const other = all.at(-2);
    check(
      "a null model, a handle, a name and a version round-trip; an absent handle stays absent",
      other.model === null && other.handle === "ui_01" && other.name === "other" && other.version === 3 && !("handle" in all[0]),
    );
    check("a wake notice's kind round-trips; a passive one has none", all.at(-1).kind === "wake" && !("kind" in all[0]));
    check("an update notice's replaces round-trips; an absent one stays absent", other.replaces === "ui_00" && !("replaces" in all[0]));
    const slack = 60_000;
    check(
      "a notice's createdAt is epoch milliseconds from when it was written",
      all.every((n) => typeof n.createdAt === "number" && n.createdAt >= before - slack && n.createdAt <= after + slack),
    );
    check("notices are scoped to their conversation", (await s.getNotices(b.id, 0)).length === 1);
    const tail = await s.getNotices(a.id, put[5].seq);
    check("`after` returns only later notices", tail.length === 3 && tail[0].seq === put[6].seq);
    const page = await s.getNotices(a.id, 0, 3);
    check("`limit` caps how many come back, from the start", page.length === 3 && page[2].seq === put[2].seq);
    all[0].payload = "mutated";
    check("a read notice is a copy", (await s.getNotices(a.id, 0))[0].payload === "hello");

    // taken in on the fenced row, with the history that records it
    check(
      "a new conversation has started no wake turns",
      JSON.stringify(a.wakes ?? []) === "[]" && (a.wokeThrough ?? 0) === 0 && (a.wakeTurns ?? 0) === 0,
    );
    a.noticedThrough = put[3].seq;
    a.wakes = [1_700_000_000_000, 1_700_000_060_000];
    a.wokeThrough = put[2].seq;
    a.wakeTurns = 7;
    a.superseded = { ui_01: "ui_02", ui_02: "ui_05" };
    a.leaseUntil = null;
    await s.saveConversation(a);
    const reloaded = await s.loadConversation(a.id);
    check("noticedThrough round-trips with the conversation", reloaded.noticedThrough === put[3].seq);
    check(
      "wakes, wokeThrough and wakeTurns round-trip with the conversation",
      JSON.stringify(reloaded.wakes) === JSON.stringify(a.wakes) && reloaded.wokeThrough === put[2].seq && reloaded.wakeTurns === 7,
    );
    check(
      "superseded round-trips with the conversation, and a new one has none",
      JSON.stringify(reloaded.superseded) === JSON.stringify(a.superseded) &&
        JSON.stringify((await s.loadConversation(undefined)).superseded ?? {}) === "{}",
    );

    // a store that can wake the events route does so, and lets go when told
    if (s.watch) {
      const aborter = new AbortController();
      const steps = s.watch(b.id, aborter.signal)[Symbol.asyncIterator]();
      const woke = steps.next();
      await s.getNotices(b.id, 0); // the route reads after it starts watching
      await s.putNotice(notice(b.id));
      const first = await Promise.race([woke, new Promise((r) => setTimeout(() => r("timeout"), 2_000))]);
      check("watch wakes when a notice lands", first !== "timeout" && first.done === false);
      // spurious wake-ups are allowed; what matters is that abort ends it
      const ended = (async () => {
        for (;;) if ((await steps.next()).done) return true;
      })();
      aborter.abort();
      const stopped = await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 2_000))]);
      check("watch ends when its signal aborts", stopped === true);
    }
  }

  // ── publish / subscribe, when a store offers them ─────────────────────
  {
    const s = make();
    if (s.publish && s.subscribe) await pubsubChecks(s, s);
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
  await noticeChecks(make);
  await wakeChecks(make);
  await updateChecks(make);
  await outsideUpdateChecks(make);
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
      if (mode === "progress") {
        // a running tool reporting twice, each frame naming only some fields,
        // and a frame for a block this client never saw
        frame({ type: "block_start", block: { kind: "tool", id: "b1", name: "search", input: {}, status: "running" } });
        frame({ type: "progress", toolId: "b1", message: "Checking fare sources", done: 0, total: 4 });
        frame({ type: "progress", toolId: "b1", done: 2 });
        frame({ type: "progress", toolId: "b9", done: 7 });
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

    // ── progress frames merge into the tool's block
    mode = "progress";
    const searching = createChat({ endpoint: "http://127.0.0.1:5378/hai", registry: {} });
    await searching.send("search");
    const searchRow = searching.state.blocks.find((b) => b.id === "b1");
    check(
      "a progress frame updates only the fields it names, and keeps no envelope",
      JSON.stringify(searchRow?.progress) === JSON.stringify({ message: "Checking fare sources", done: 2, total: 4 }),
    );
    check(
      "a frame for a block the client never saw changes nothing",
      searching.state.blocks.filter((b) => b.progress).length === 1,
    );

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

// ── notices reach the model in the next user message, and only there ────
// A notice never touches the history when it is sent: whoever holds the turn,
// the next request that records a user message takes it in, after any tool
// results, and the history's `noticedThrough` moves with it on the fenced row.
async function noticeChecks(make) {
  console.log("\nnotices");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineNotice, defineSurface, defineTool, resolve, inform, StaleLease } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make();

  const flightOnly = {
    parse(v) {
      if (typeof v?.flight !== "string") throw new Error("flight must be a string");
      return { flight: v.flight };
    },
  };
  const held = defineNotice({ name: "held", version: 2, payload: flightOnly }).implement({
    model: (p) => `${p.flight} is held.`,
  });
  const quiet = defineNotice({ name: "quiet", version: 1, payload: any }).implement({ model: () => null });
  const stray = defineNotice({ name: "stray", version: 1, payload: any }).implement({ model: () => "x" });
  const broken = defineNotice({ name: "broken", version: 1, payload: any }).implement({ model: () => 42 });

  const picker = defineSurface({ name: "pick", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} })
    .implement({ digest: () => "a picker", actions: { choose: (v) => `Chose ${v}.` }, queries: {} });
  const card = defineSurface({ name: "card", version: 1, props: any, actions: { note: inform(any) }, queries: {} })
    .implement({ digest: () => "a card", actions: { note: (v) => `Noted ${v}.` }, queries: {} });
  const show = defineTool({
    name: "show",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    run: (i, ctx) => (i.kind === "pick" ? ctx.render(picker, {}, { mode: "elicit" }) : ctx.render(card, {})),
  });
  const next = [];
  const model = {
    id: "stub",
    async generate() {
      const kind = next.shift();
      if (kind) return { content: [{ type: "tool_use", id: `tu_${kind}_${Math.random()}`, name: "show", input: { kind } }], stop_reason: "tool_use" };
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const hai = createHai({ model, store, tools: [show], surfaces: [picker, card], notices: [held, quiet, broken], system: "x" });
  const plain = createHai({ model, store, tools: [show], surfaces: [picker, card], system: "x" });

  async function request(app, id, act) {
    const c = await store.loadConversation(id);
    let error = null;
    try {
      await act(c, () => {});
    } catch (err) {
      error = err;
    }
    c.leaseUntil = null;
    await store.saveConversation(c);
    return { c, error };
  }
  const say = (app, text) => (c, emit) => app.send(c, text, emit);
  const click = (app, handle, action, value) => (c, emit) => app.interact(c, { handle, action, value }, emit);
  const refused = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const lastUser = (c) => c.messages.filter((m) => m.role === "user").at(-1).content;
  const note = (flight) => ({ type: "text", text: `[App notification: held] ${flight} is held.` });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── what notify refuses, before anything is stored
  next.push("card");
  const opened = await request(hai, undefined, say(hai, "hi"));
  const id = opened.c.id;
  const cardHandle = opened.c.handles[0];
  check("an app that sends notices says so to the browser", hai.sendsNotices && !plain.sendsNotices);
  check("an unregistered notice is refused", await refused(() => hai.notify(id, stray, {})));
  check("a payload that fails its schema is refused", await refused(() => hai.notify(id, held, { flight: 7 })));
  check("a model() that returns neither text nor null is refused", await refused(() => hai.notify(id, broken, {})));
  check("a handle with no surface stored in the conversation is refused", await refused(() => hai.notify(id, held, { flight: "X" }, { handle: "ui_99" })));
  check("a notice for an unknown conversation is refused", await refused(() => hai.notify("conv_nope", held, { flight: "X" })));
  check("nothing refused was stored", same(await store.getNotices(id, 0), []));
  check("two notices with one name are refused at construction", await refused(async () =>
    createHai({ model, store, tools: [], surfaces: [], notices: [held, held], system: "x" })));

  // ── idle: the next message carries it, ahead of what the user typed
  const { seq } = await hai.notify(id, held, { flight: "AC832", extra: "dropped by the schema" }, { handle: cardHandle });
  const [stored] = await store.getNotices(id, 0);
  check(
    "a notice is stored validated, with its model text, version and handle",
    seq === stored.seq && same(stored.payload, { flight: "AC832" }) && stored.model === "AC832 is held." &&
      stored.version === 2 && stored.handle === cardHandle,
  );
  const quietSeq = (await hai.notify(id, quiet, { anything: true })).seq;
  const idle = await request(hai, id, say(hai, "anything new?"));
  check(
    "the next message carries the notice ahead of what the user typed",
    same(lastUser(idle.c), [note("AC832"), { type: "text", text: "anything new?" }]),
  );
  check("a notice with no model text is taken in without a word", idle.c.noticedThrough === quietSeq);
  const again = await request(hai, id, say(hai, "and now?"));
  check("a notice is taken in once", lastUser(again.c) === "and now?");

  // ── parked: it rides with the answer, after the tool results
  next.push("pick");
  const parked = await request(hai, id, say(hai, "pick one"));
  const pickHandle = parked.c.handles.at(-1);
  await hai.notify(id, held, { flight: "NH7" });
  const stillParked = await store.loadConversation(id);
  check("a notice sent while a question waits leaves the history alone", stillParked.messages.length === parked.c.messages.length);
  stillParked.leaseUntil = null;
  await store.saveConversation(stillParked);
  const answered = await request(hai, id, click(hai, pickHandle, "choose", "A"));
  const answer = answered.c.messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && /Chose A/.test(b.content)));
  check(
    "an answer carries the notice after its tool result",
    answer?.content.at(-2)?.type === "tool_result" && same(answer.content.at(-1), note("NH7")),
  );

  // ── typed over a question: it rides with what the user typed
  next.push("pick");
  await request(hai, id, say(hai, "pick again"));
  await hai.notify(id, held, { flight: "JL1" });
  const typed = await request(hai, id, say(hai, "never mind"));
  check(
    "a message typed over a question carries it",
    same(lastUser(typed.c), [note("JL1"), { type: "text", text: "never mind" }]),
  );

  // ── an inform click carries it too
  await hai.notify(id, held, { flight: "UA9" });
  const informed = await request(hai, id, click(hai, cardHandle, "note", "aisle"));
  check(
    "an inform click carries it",
    same(lastUser(informed.c), [note("UA9"), { type: "text", text: "[UI interaction] Noted aisle." }]),
  );

  // ── a click whose save is lost takes nothing in
  await hai.notify(id, held, { flight: "DL5" });
  const before = await store.loadConversation(id);
  const through = before.noticedThrough;
  before.leaseUntil = null;
  await store.saveConversation(before);
  const losing = { ...store, saveConversation: async (c) => { throw new StaleLease(c.id); } };
  const fenced = createHai({ model, store: losing, tools: [show], surfaces: [picker, card], notices: [held], system: "x" });
  const lost = await store.loadConversation(id);
  let threw = false;
  try {
    await fenced.interact(lost, { handle: cardHandle, action: "note", value: "x" }, () => {});
  } catch {
    threw = true;
  }
  check("a click whose save is rejected puts noticedThrough back", threw && lost.noticedThrough === through);
  lost.leaseUntil = null;
  await store.saveConversation(lost);
  const retaken = await request(hai, id, say(hai, "still there?"));
  check("…so the next message takes the notice in", same(lastUser(retaken.c)[0], note("DL5")));

  // ── an app without notices keeps the history it always had
  const unchanged = await request(plain, undefined, say(plain, "hello"));
  check("with no notices, a message stays plain text", unchanged.c.messages[0].content === "hello");
}

// ── a wake notice starts a turn, when the conversation can take one ─────
// hai.wake is what the events route calls. It takes the lease like any
// request, and releases it before it resolves.
async function wakeChecks(make) {
  console.log("\nwake notices");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineNotice, defineSurface, defineTool, resolve } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make();

  const held = defineNotice({ name: "held", version: 1, payload: any }).implement({ model: (p) => `${p.flight} is held.` });
  const dropped = defineNotice({ name: "dropped", version: 1, kind: "wake", payload: any }).implement({
    model: (p) => `${p.flight} is cheaper.`,
  });
  const mute = defineNotice({ name: "mute", version: 1, kind: "wake", payload: any }).implement({ model: () => null });
  const picker = defineSurface({ name: "pick", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} })
    .implement({ digest: () => "a picker", actions: { choose: (v) => `Chose ${v}.` }, queries: {} });
  const brief = defineSurface({ name: "brief", version: 1, props: any }).implement({
    digest: () => "short-lived",
    actions: {},
    queries: {},
    staleAfterMs: 20,
  });
  const show = defineTool({
    name: "show",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    run: (i, ctx) => (i.kind === "pick" ? ctx.render(picker, {}, { mode: "elicit" }) : ctx.render(brief, {})),
  });
  const next = [];
  const seen = [];
  let down = false; // the model fails, as a provider outage would
  const model = {
    id: "stub",
    async generate(req) {
      seen.push(JSON.parse(JSON.stringify(req.messages)));
      if (down) throw new Error("model unavailable");
      const kind = next.shift();
      if (kind) return { content: [{ type: "tool_use", id: `tu_${kind}_${seen.length}`, name: "show", input: { kind } }], stop_reason: "tool_use" };
      return { content: [{ type: "text", text: "noted" }], stop_reason: "end_turn" };
    },
  };
  const make2 = (maxWakes) => createHai({ model, store, tools: [show], surfaces: [picker, brief], notices: [held, dropped, mute], system: "x", maxWakes });
  const hai = make2({ count: 1, perMs: 300 });

  async function request(id, act) {
    const c = await store.loadConversation(id);
    try {
      await act(c, () => {});
    } finally {
      c.leaseUntil = null;
      await store.saveConversation(c);
    }
    return c;
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);
  const peek = async (id) => {
    const c = await store.loadConversation(id);
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c;
  };
  const lastUser = (c) => c.messages.filter((m) => m.role === "user").at(-1).content;
  const note = (name, text) => ({ type: "text", text: `[App notification: ${name}] ${text}` });
  const WOKEN = { type: "text", text: "[The user has not said anything. The notifications above arrived on their own.]" };
  // by content, not key order: a jsonb column hands keys back in an order of its own
  const canon = (v) =>
    JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  const same = (a, b) => canon(a) === canon(b);
  const refused = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const events = [];
  const watch = (e) => events.push(e);

  check("an app with a wake notice says so", hai.wakes && !createHai({ model, store, tools: [], surfaces: [], notices: [held], system: "x" }).wakes);
  check(
    "a maxWakes that would never or always wake is refused",
    (await refused(async () => make2({ count: 0, perMs: 1000 }))) && (await refused(async () => make2({ count: 1, perMs: Infinity }))),
  );

  // ── nothing to wake for, or nowhere to
  check("an unknown conversation does not wake, nor come to exist", (await hai.wake("conv_nope", watch)) === "idle" &&
    (await store.getNotices("conv_nope", 0)) === null);
  const fresh = await request(undefined, async () => {});
  await hai.notify(fresh.id, dropped, { flight: "A1" });
  check("a conversation that hasn't begun does not wake", (await hai.wake(fresh.id, watch)) === "idle" && (await peek(fresh.id)).messages.length === 0);
  check("a wake notice whose model() returns null is refused", await refused(() => hai.notify(fresh.id, mute, {})));

  const id = (await request(undefined, say("hi"))).id;
  await hai.notify(id, held, { flight: "AC832" });
  const quiet = (await peek(id)).messages.length;
  check("passive notices alone do not wake", (await hai.wake(id, watch)) === "idle" && (await peek(id)).messages.length === quiet);

  // ── a wake notice starts a turn carrying every unread notice
  await hai.notify(id, dropped, { flight: "AC832" });
  const before = seen.length;
  events.length = 0;
  check("an idle conversation with a wake notice wakes", (await hai.wake(id, watch)) === "woke");
  let c = await peek(id);
  const firstFrame = events.find((e) => e.type === "status");
  check(
    "a wake turn's first frame says it is streaming, with the turn's number in the conversation",
    firstFrame?.status === "streaming" && firstFrame.wake === 1 && c.wakeTurns === 1,
  );
  check(
    "the turn's user message carries every unread notice, then says the user wrote none of it",
    same(lastUser(c), [note("held", "AC832 is held."), note("dropped", "AC832 is cheaper."), WOKEN]),
  );
  check("the model ran once, and its reply is in the history", seen.length === before + 1 && c.messages.at(-1).role === "assistant");
  check(
    "the turn streams to whoever called, and the lease is released",
    events.some((e) => e.type === "text_delta" || e.type === "status") && c.leaseUntil === null,
  );
  check("a woken notice does not wake again", (await hai.wake(id, watch)) === "idle");

  // ── maxWakes: past it, wake notices wait for the user, for good
  await hai.notify(id, dropped, { flight: "NH7" });
  const limitedAt = (await peek(id)).messages.length;
  check("a second wake inside the window is held back", (await hai.wake(id, watch)) === "limited");
  check("…and leaves the history alone", (await peek(id)).messages.length === limitedAt);
  await new Promise((r) => setTimeout(r, 350)); // the window passes
  check("once held back, a notice never wakes later", (await hai.wake(id, watch)) === "idle");
  const typed = await request(id, say("anything?"));
  check("it rides the user's next message instead", same(lastUser(typed)[0], note("dropped", "NH7 is cheaper.")));

  // ── several at once make one turn
  for (const flight of ["X1", "X2", "X3"]) await hai.notify(id, dropped, { flight });
  const batchFrom = seen.length;
  check("three wake notices wake once", (await hai.wake(id, watch)) === "woke" && seen.length === batchFrom + 1);
  check("…carrying all three", lastUser(await peek(id)).length === 4);

  // ── busy: someone else holds the conversation
  const holder = await store.loadConversation(id);
  await hai.notify(id, dropped, { flight: "B1" });
  check("a conversation another request holds is busy", (await hai.wake(id, watch)) === "busy");
  holder.leaseUntil = null;
  await store.saveConversation(holder);

  // ── a question waiting: no turn, and the answer carries the notice
  const waitingHai = make2({ count: 10, perMs: 60_000 });
  next.push("pick");
  const parked = await request(id, (c2, emit) => waitingHai.send(c2, "pick", emit));
  const pick = parked.handles.at(-1);
  await waitingHai.notify(id, dropped, { flight: "P1" });
  check("a conversation waiting on a question does not wake", (await waitingHai.wake(id, watch)) === "idle");
  const answered = await request(id, (c2, emit) => waitingHai.interact(c2, { handle: pick, action: "choose", value: "A" }, emit));
  const answer = answered.messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && /Chose A/.test(b.content)));
  check("…its answer carries the notice, after the tool result", same(answer.content.at(-1), note("dropped", "P1 is cheaper.")));

  // ── a turn that fails is undone: no half-recorded history, notices unread
  const failing = make2({ count: 10, perMs: 60_000 });
  const fid = (await request(undefined, (c2, emit) => failing.send(c2, "hi", emit))).id;
  await failing.notify(fid, dropped, { flight: "DOWN" });
  const intact = await peek(fid);
  down = true;
  const failEvents = [];
  const failed = await failing.wake(fid, (e) => failEvents.push(e));
  down = false;
  const after = await peek(fid);
  check("a wake turn whose model fails reports it", failed === "failed");
  check(
    "…and leaves the history as it was: no stray user message, status idle, the notice unread",
    after.messages.length === intact.messages.length && after.status === "idle" &&
      after.noticedThrough === intact.noticedThrough && (after.wokeThrough ?? 0) === (intact.wokeThrough ?? 0),
  );
  check(
    "…telling the browser, and then that it may send again",
    failEvents.some((e) => e.type === "error") && failEvents.at(-1)?.type === "released",
  );
  check("…and counts against maxWakes, so an outage can't be retried endlessly", (after.wakes ?? []).length === 1);
  check("…and takes a turn number, so a retry is numbered after it", after.wakeTurns === 1);
  const retryFrames = [];
  check("once the model is back, the notice wakes", (await failing.wake(fid, (e) => retryFrames.push(e))) === "woke" &&
    retryFrames.find((e) => e.type === "status")?.wake === 2 &&
    same(lastUser(await peek(fid))[0], note("dropped", "DOWN is cheaper.")));

  // ── a turn that fails after a tool ran keeps what happened, and never wakes again
  {
    const bookStore = make();
    let bookings = 0;
    const book = defineTool({
      name: "book",
      description: "d",
      input: any,
      inputJsonSchema: { type: "object" },
      run: (_i, ctx) => (bookings++, ctx.text("Booked.")),
    });
    let calls = 0;
    const flakyModel = {
      id: "flaky",
      async generate(req) {
        const last = req.messages.at(-1).content;
        const woke = Array.isArray(last) && last.at(-1)?.text?.startsWith("[The user");
        if (woke) {
          calls++;
          return { content: [{ type: "tool_use", id: `tu_book_${calls}`, name: "book", input: {} }], stop_reason: "tool_use" };
        }
        if (Array.isArray(last) && last.some((b) => b.type === "tool_result")) throw new Error("model unavailable");
        return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
      },
    };
    const bookHai = createHai({ model: flakyModel, store: bookStore, tools: [book], surfaces: [], notices: [dropped], system: "x", maxWakes: { count: 10, perMs: 60_000 } });
    const c = await bookStore.loadConversation(undefined);
    await bookHai.send(c, "hi", () => {});
    c.leaseUntil = null;
    await bookStore.saveConversation(c);
    await bookHai.notify(c.id, dropped, { flight: "BOOK" });
    const outcome = await bookHai.wake(c.id, () => {});
    const kept = await bookStore.loadConversation(c.id);
    kept.leaseUntil = null;
    await bookStore.saveConversation(kept);
    const blocks = kept.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    check(
      "a wake turn that fails after a tool ran keeps the tool's call and result, and closes",
      outcome === "failed" && bookings === 1 && blocks.some((b) => b.type === "tool_use" && b.name === "book") &&
        blocks.some((b) => b.type === "tool_result" && b.content === "Booked.") && kept.status === "idle",
    );
    check(
      "…and its notice never wakes again, so the tool never runs twice",
      (await bookHai.wake(c.id, () => {})) === "idle" && bookings === 1,
    );
  }

  // ── a wake turn that outlasts its lease is not run again by a takeover
  {
    const shortStore = make({ leaseMs: 60 });
    let wakeRuns = 0;
    const slowModel = {
      id: "slow",
      async generate(req) {
        const last = req.messages.at(-1).content;
        if (Array.isArray(last) && last.at(-1)?.text?.startsWith("[The user")) {
          wakeRuns++;
          await new Promise((r) => setTimeout(r, 150)); // longer than the lease
        }
        return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
      },
    };
    const slowHai = createHai({ model: slowModel, store: shortStore, tools: [], surfaces: [], notices: [dropped], system: "x", maxWakes: { count: 10, perMs: 60_000 } });
    const c = await shortStore.loadConversation(undefined);
    await slowHai.send(c, "hi", () => {});
    c.leaseUntil = null;
    await shortStore.saveConversation(c);
    await slowHai.notify(c.id, dropped, { flight: "SLOW" });
    const first = slowHai.wake(c.id, () => {}).catch(() => "threw");
    await new Promise((r) => setTimeout(r, 100)); // the first turn's lease has lapsed
    const second = await slowHai.wake(c.id, () => {});
    await first;
    check(
      `a takeover of a wake turn that outlasts its lease finds nothing to wake for (${second}, ${wakeRuns} model call)`,
      second === "idle" && wakeRuns === 1,
    );
  }

  // ── a save that fails still lets the browser go
  {
    const flaky = make();
    let saves = 0;
    const failingSave = { ...flaky, saveConversation: async (c2) => (++saves === 2 ? Promise.reject(new Error("database away")) : flaky.saveConversation(c2)) };
    const flakyHai = createHai({ model, store: failingSave, tools: [], surfaces: [], notices: [dropped], system: "x", maxWakes: { count: 10, perMs: 60_000 } });
    const c = await flaky.loadConversation(undefined);
    await flakyHai.send(c, "hi", () => {});
    c.leaseUntil = null;
    await flaky.saveConversation(c);
    await flakyHai.notify(c.id, dropped, { flight: "LOSSY" });
    const sent = [];
    saves = 0; // the wake's own saves: the commit, then the one on the way out
    let threw = false;
    try {
      await flakyHai.wake(c.id, (e) => sent.push(e.type));
    } catch {
      threw = true;
    }
    check(
      "a wake whose final save fails still tells the browser it may send, then throws for its caller to report",
      threw && sent.at(-1) === "released" && !sent.includes("error"),
    );
  }

  // ── out of date: no turn
  next.push("brief");
  await request(id, (c2, emit) => waitingHai.send(c2, "brief", emit));
  await new Promise((r) => setTimeout(r, 40));
  await waitingHai.notify(id, dropped, { flight: "OLD" });
  const staleAt = (await peek(id)).messages.length;
  check("an out-of-date conversation does not wake", (await waitingHai.wake(id, watch)) === "idle" && (await peek(id)).messages.length === staleAt);
}

// ── a tool revises a surface in place: ctx.update ──────────────────────
// A revision is a new surface, with a new handle, that supersedes the old
// one: clicks on the old are refused, its window stops counting, and the
// model hears the new digest as the tool's result.
async function updateChecks(make) {
  console.log("\nsurface revisions");
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool, resolve, inform, query, StaleLease } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const store = make();
  const card = defineSurface({ name: "card", version: 1, props: any, actions: { note: inform(any) }, queries: { price: query(any, "the price", { type: "object", properties: {} }) } })
    .implement({
      digest: (p, { handle }) => {
        // a price of 7 makes for a slow digest
        if (p.price === 7) for (const end = Date.now() + 300; Date.now() < end; );
        return `card ${p.price} as ${handle}`;
      },
      actions: { note: (v, { props }) => `noted ${v} at ${props.price}` },
      queries: { price: (_a, { props, cap }) => cap([props.price], (x) => `price ${x}`) },
      staleAfterMs: 400,
    });
  const other = defineSurface({ name: "other", version: 1, props: any }).implement({ digest: () => "other", actions: {}, queries: {} });
  const picker = defineSurface({ name: "pick", version: 1, props: any, actions: { choose: resolve(any) }, queries: {} })
    // a digest may be anything, "" included
    .implement({ digest: (p, { handle }) => (p.v === "EMPTY" ? "" : `pick ${p.v} as ${handle}`), actions: { choose: (v, { props }) => `chose ${v} from ${props.v}` }, queries: {} });

  const errors = [];
  let lastAsked = null; // the question the tool last showed, for a revision in the same reply
  const tool = defineTool({
    name: "t",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    async run(i, ctx) {
      if (i.op === "card") return ctx.render(card, { price: i.price });
      if (i.op === "other") return ctx.render(other, {});
      if (i.op === "update") return ctx.update(card, i.handle, { price: i.price });
      if (i.op === "update-asked") return ctx.update(picker, lastAsked, { v: i.v });
      if (i.op === "ask") {
        const ret = await ctx.render(picker, { v: i.v }, { mode: "elicit" });
        lastAsked = ret.handle;
        return ret;
      }
      if (i.op === "ask-extra") {
        // asks, then says something more, which rides after the question's digest
        const ret = await ctx.render(picker, { v: i.v }, { mode: "elicit" });
        lastAsked = ret.handle;
        return ctx.text("also: a note");
      }
      if (i.op === "ask-revise-extra") {
        // asks, revises its own question, then says something more
        const ret = await ctx.render(picker, { v: i.v }, { mode: "elicit" });
        const revised = await ctx.update(picker, ret.handle, { v: i.then });
        lastAsked = revised.handle;
        return ctx.text("also: a note");
      }
      if (i.op === "late-try") {
        await new Promise((r) => setTimeout(r, i.wait));
        try {
          await ctx.update(card, i.handle, { price: 2 });
          return ctx.text("revised");
        } catch (err) {
          errors.push(err.message);
          return ctx.text(`refused: ${err.message}`);
        }
      }
      if (i.op === "try") {
        try {
          await ctx.update(card, i.handle, { price: i.price ?? 1 });
          return ctx.text("revised");
        } catch (err) {
          errors.push(err.message);
          return ctx.text(`refused: ${err.message}`);
        }
      }
      return ctx.text("?");
    },
  });
  const next = []; // the tool calls the model makes next, one reply at a time
  const model = {
    id: "stub",
    async generate({ messages }) {
      const last = messages.at(-1).content;
      const replying = Array.isArray(last) && last.some((b) => b.type === "tool_result");
      if (!replying && next.length) {
        const calls = next.shift();
        return {
          content: calls.map((input, i) => ({
            type: "tool_use",
            id: `tu_${Math.random()}_${i}`,
            name: input.query ? "query_ui" : "t",
            input,
          })),
          stop_reason: "tool_use",
        };
      }
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const hai = createHai({ model, store, tools: [tool], surfaces: [card, other, picker], system: "x" });
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
    await store.saveConversation(c);
    return { c, events, error };
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);
  const click = (handle, action, value) => (c, emit) => hai.interact(c, { handle, action, value }, emit);
  const results = (c) => c.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result").map((b) => b.content);

  // ── revise a card shown in an earlier turn
  next.push([{ op: "card", price: 343 }]);
  const shown = await request(undefined, say("show it"));
  const id = shown.c.id;
  const first = shown.c.handles[0];
  next.push([{ op: "update", handle: first, price: 389 }]);
  const revised = await request(id, say("reprice it"));
  const second = revised.c.handles.at(-1);
  const opened = revised.events.find((e) => e.type === "ui_open");
  check(
    "ctx.update stores a new surface that supersedes the old, and says which it replaces",
    second !== first && revised.c.superseded?.[first] === second && opened?.handle === second && opened.replaces === first,
  );
  check("the model hears the revision's digest as the tool's result", results(revised.c).at(-1) === `card 389 as ${second}`);

  // ── clicks: the old handle is refused, the new one acts on the new props
  const stale = await request(id, click(first, "note", "x"));
  check(`a click on the superseded handle is refused (${stale.error?.message})`, stale.error?.message === `superseded by ${second}`);
  const fresh = await request(id, click(second, "note", "x"));
  check("a click on the revision acts on its props", !fresh.error && fresh.c.messages.some((m) => JSON.stringify(m.content).includes("noted x at 389")));

  // ── query_ui on the old handle answers from what it was, and says it moved on
  next.push([{ handle: first, query: "price", args: {} }]);
  const queried = await request(id, say("what was the price?"));
  const answer = results(queried.c).at(-1) ?? "";
  check(
    "query_ui on a superseded handle answers from its data, and says what it is now",
    answer.includes("price 343") && answer.includes(`${first} has since been revised: it is ${second} now`),
  );

  // ── what can't be revised
  next.length = 0;
  next.push([{ op: "other" }]);
  const withOther = await request(id, say("other"));
  const otherHandle = withOther.c.handles.at(-1);
  errors.length = 0;
  next.push([{ op: "try", handle: first }]);
  await request(id, say("again"));
  next.push([{ op: "try", handle: otherHandle }]);
  await request(id, say("wrong contract"));
  next.push([{ op: "try", handle: "ui_999" }]);
  await request(id, say("unknown"));
  check(
    "a superseded handle, a different contract, and an unknown handle are refused",
    errors[0] === `${first} was revised already: it is ${second} now` && /is a other, not a card/.test(errors[1] ?? "") &&
      /no surface ui_999/.test(errors[2] ?? ""),
  );

  // ── an answered surface can't be revised
  next.push([{ op: "ask", v: "A" }]);
  const asking = await request(id, say("ask"));
  const asked = asking.c.pending.handle;
  await request(id, click(asked, "choose", "A"));
  errors.length = 0;
  next.push([{ op: "try", handle: asked }]);
  await request(id, say("revise the answered one"));
  check("an answered surface can't be revised", /was answered/.test(errors[0] ?? ""));

  // ── a question revised in the same reply waits on its revision
  next.push([{ op: "ask", v: "B" }, { op: "update-asked", v: "C" }]);
  const twice = await request(id, say("ask, then revise it"));
  const askedFirst = lastAsked;
  const waitingOn = twice.c.pending?.handle;
  check(
    "a question revised in the same reply waits on its revision",
    waitingOn && waitingOn !== askedFirst && twice.c.superseded?.[askedFirst] === waitingOn,
  );
  const oldAnswer = await request(id, click(askedFirst, "choose", "x"));
  const newAnswer = await request(id, click(waitingOn, "choose", "C"));
  check(
    "…and is answered there, with the revision's props",
    /superseded/.test(oldAnswer.error?.message ?? "") && !newAnswer.error &&
      newAnswer.c.messages.some((m) => JSON.stringify(m.content).includes("chose C from C")),
  );
  // the asking call said more after its question: that stays
  next.push([{ op: "ask-extra", v: "B2" }, { op: "update-asked", v: "C2" }]);
  const extra = await request(id, say("ask, add a note, then revise it"));
  check(
    "a revised question keeps what its asking call said after it",
    extra.c.pending?.digest === `pick C2 as ${extra.c.pending?.handle}\nalso: a note`,
  );
  // …and so it does when the asking call revised its question itself first
  next.push([{ op: "ask-revise-extra", v: "B4", then: "C4" }, { op: "update-asked", v: "D4" }]);
  const own = await request(id, say("ask, revise it, add a note, then revise it again"));
  check(
    `a question its own call revised, then a later call revised again, keeps that call's extra text (${JSON.stringify(own.c.pending?.digest)})`,
    own.c.pending?.digest === `pick D4 as ${own.c.pending?.handle}\nalso: a note`,
  );
  // a revision whose digest is empty is still the revision's
  next.push([{ op: "ask", v: "B3" }, { op: "update-asked", v: "EMPTY" }]);
  const empty = await request(id, say("ask, then revise it to nothing"));
  check("a revision's empty digest is kept, not mistaken for none", empty.c.pending?.digest === "");
  check(
    "…and its answer goes to the model under the revision's digest, not the original's",
    twice.c.pending?.digest === `pick C as ${waitingOn}` &&
      newAnswer.c.messages.some((m) => JSON.stringify(m.content).includes(`pick C as ${waitingOn}\\nchose C from C`)),
  );

  // ── freshness: a revised surface's window stops counting
  next.push([{ op: "card", price: 10 }]);
  const brief = await request(undefined, say("show"));
  const bid = brief.c.id;
  await new Promise((r) => setTimeout(r, 250));
  next.push([{ op: "update", handle: brief.c.handles[0], price: 11 }]);
  await request(bid, say("refresh"));
  await new Promise((r) => setTimeout(r, 250)); // the first card's 400 ms window has passed; its revision's hasn't
  const later = await request(bid, say("still fine?"));
  check("a revised surface's window stops counting; its revision's counts instead", !later.events.some((e) => e.type === "expired"));
  await new Promise((r) => setTimeout(r, 300));
  const expired = await request(bid, say("now?"));
  check("…and the revision's window still closes it in time", expired.events.some((e) => e.type === "expired"));

  // ── a turn that outlasts a surface's window can't revive it by revising it
  next.push([{ op: "card", price: 5 }]);
  const lapsing = await request(undefined, say("show"));
  errors.length = 0;
  next.push([{ op: "late-try", handle: lapsing.c.handles[0], wait: 500 }]); // fresh when the turn begins, not by the revision
  const lapsed = await request(lapsing.c.id, say("revise it, slowly"));
  check(
    "a revision is refused once the conversation has gone out of date during the turn",
    /out of date/.test(errors[0] ?? "") && !lapsed.c.superseded?.[lapsing.c.handles[0]],
  );
  const after = await request(lapsing.c.id, say("and now?"));
  check("…and the conversation stays out of date", after.events.some((e) => e.type === "expired"));

  // ── …nor by a window that runs out while the revision reads the surface
  {
    let slowRead = false;
    const slowStore = {
      ...store,
      async getPayload(...args) {
        if (slowRead) await new Promise((r) => setTimeout(r, 300));
        return store.getPayload(...args);
      },
    };
    const slowHai = createHai({ model, store: slowStore, tools: [tool], surfaces: [card, other, picker], system: "x" });
    next.push([{ op: "card", price: 6 }]);
    const showing = await request(undefined, say("show"));
    await new Promise((r) => setTimeout(r, 200)); // fresh, with 200 ms of its 400 left
    errors.length = 0;
    slowRead = true; // the revision's read takes 300 ms: the window runs out during it
    next.push([{ op: "try", handle: showing.c.handles[0] }]);
    const c = await slowStore.loadConversation(showing.c.id);
    await slowHai.send(c, "revise it", () => {});
    slowRead = false;
    c.leaseUntil = null;
    await store.saveConversation(c);
    check(
      "a window that runs out while the revision reads the surface is caught before the write",
      /out of date/.test(errors[0] ?? "") && !c.superseded?.[showing.c.handles[0]],
    );
  }

  // ── …nor by one that runs out while the revision is stored and digested
  next.push([{ op: "card", price: 8 }]);
  const digesting = await request(undefined, say("show"));
  await new Promise((r) => setTimeout(r, 200)); // fresh, with 200 ms of its 400 left
  errors.length = 0;
  next.push([{ op: "try", handle: digesting.c.handles[0], price: 7 }]); // its digest takes 300 ms
  const slowDigest = await request(digesting.c.id, say("revise it"));
  check(
    "a window that runs out while the revision is digested is caught before it takes effect",
    /went out of date while the revision was made/.test(errors[0] ?? "") &&
      !slowDigest.c.superseded?.[digesting.c.handles[0]] && slowDigest.c.handles.length === 1 &&
      !slowDigest.events.some((e) => e.type === "ui_open"),
  );

  // ── a revision an overtaken turn made is inert
  next.push([{ op: "card", price: 1 }]);
  const base = await request(undefined, say("show"));
  const oid = base.c.id;
  const original = base.c.handles[0];
  const losing = { ...store, saveConversation: async (c) => { throw new StaleLease(c.id); } };
  const fenced = createHai({ model, store: losing, tools: [tool], surfaces: [card, other, picker], system: "x" });
  next.push([{ op: "update", handle: original, price: 2 }]);
  const lost = await store.loadConversation(oid);
  const asItWas = JSON.parse(JSON.stringify(lost));
  try {
    await fenced.send(lost, "revise", () => {});
  } catch {}
  // the turn's save is lost: what is stored is the conversation from before it
  asItWas.leaseUntil = null;
  await store.saveConversation(asItWas);
  const kept = await store.loadConversation(oid);
  kept.leaseUntil = null;
  await store.saveConversation(kept);
  const stillThere = await request(oid, click(original, "note", "y"));
  check("a revision whose turn's save was lost leaves the original clickable", !stillThere.error && !kept.superseded?.[original]);
}

// ── the events stream, and the client that follows it ──────────────────
// Real parts end to end: a Hai with notices behind nodeHandler, read first with
// plain fetches, then by createChat.
// ── hai.update: revising a surface from outside any turn ──────────────
// Stored and attached under the lease, as ctx.update is; the model hears of
// it as an update notice, the browser through the events stream.
async function outsideUpdateChecks(make) {
  const { createHai } = await import("../packages/server/dist/index.js");
  const { defineNotice, defineSurface, defineTool, resolve, inform, isConversationBusy } = await import("../packages/core/dist/index.js");
  const any = { parse: (v) => v };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = make();
  // set to make the next update notice fail to store
  let failNotice = false;
  // set to hold every payload write this long once it has written
  let slowPut = 0;
  const store = {
    ...base,
    putNotice: (record) => (failNotice && record.replaces ? Promise.reject(new Error("notice store down")) : base.putNotice(record)),
    putPayload: async (record, token) => {
      const handle = await base.putPayload(record, token);
      if (slowPut) await wait(slowPut);
      return handle;
    },
  };
  const priced = (name, staleAfterMs) =>
    defineSurface({
      name,
      version: 1,
      props: { parse: (v) => { if (typeof v?.price !== "number") throw new Error("price must be a number"); return v; } },
      actions: { note: inform(any) },
    }).implement({
      digest: (p, { handle }) => `card ${p.price} as ${handle}`,
      actions: { note: (v, { props }) => `noted ${v} at ${props.price}` },
      queries: {},
      staleAfterMs,
    });
  // a window no run of this suite outlasts, however slow the machine
  const card = priced("card", 60_000);
  // and one that the expiry checks wait out
  const brief = priced("brief", 1_000);
  const picker = defineSurface({ name: "pick", version: 1, props: any, actions: { choose: resolve(any) } }).implement({
    digest: (p, { handle }) => `pick ${p.v} as ${handle}`,
    actions: { choose: (v, { props }) => `chose ${v} from ${props.v}` },
    queries: {},
  });
  const stray = defineSurface({ name: "stray", version: 1, props: any }).implement({ digest: () => "stray", actions: {}, queries: {} });
  const tool = defineTool({
    name: "t",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    run: (i, ctx) =>
      i.op === "ask"
        ? ctx.render(picker, { v: i.v }, { mode: "elicit" })
        : ctx.render(i.op === "brief" ? brief : card, { price: i.price }),
  });
  const next = [];
  const heard = []; // every message list the model was given
  const model = {
    id: "stub",
    async generate({ messages }) {
      heard.push(JSON.stringify(messages));
      const last = messages.at(-1).content;
      const replying = Array.isArray(last) && last.some((b) => b.type === "tool_result");
      if (!replying && next.length) {
        return { content: [{ type: "tool_use", id: `tu_${Math.random()}`, name: "t", input: next.shift() }], stop_reason: "tool_use" };
      }
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const hai = createHai({ model, store, tools: [tool], surfaces: [card, brief, picker], system: "x", updates: true });
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
    await store.saveConversation(c);
    return { c, events, error };
  }
  const say = (text) => (c, emit) => hai.send(c, text, emit);
  const click = (handle, action, value) => (c, emit) => hai.interact(c, { handle, action, value }, emit);
  // the conversation as stored, without keeping its lease
  const peek = async (id) => {
    const c = await store.loadConversation(id);
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c;
  };
  const updates = async (id) => (await store.getNotices(id, 0)).filter((n) => n.replaces !== undefined);
  const failed = async (p) => {
    try {
      await p;
      return null;
    } catch (err) {
      return err;
    }
  };

  // ── a revision from outside: stored, attached, and announced
  next.push({ price: 343 });
  const shown = await request(undefined, say("show it"));
  const id = shown.c.id;
  const first = shown.c.handles[0];
  const { handle: second } = await hai.update(id, card, first, { price: 389 });
  let c = await peek(id);
  check(
    "hai.update stores a revision that supersedes the surface, and resolves to its handle",
    second !== first && c.handles.at(-1) === second && c.superseded?.[first] === second,
  );
  const [notice] = await updates(id);
  check(
    "…and appends an update notice naming both handles, with the new digest for the model",
    notice?.handle === second && notice.replaces === first && notice.kind === undefined &&
      notice.model === `${first} was replaced by ${second}; its earlier digest is out of date. Now: card 389 as ${second}`,
  );
  check("…and lets the conversation go", c.leaseUntil === null || c.leaseUntil < Date.now());
  const stale = await request(id, click(first, "note", "x"));
  check(`a click on the replaced handle is refused (${stale.error?.message})`, stale.error?.message === `superseded by ${second}`);
  const acted = await request(id, click(second, "note", "x"));
  check(
    "a click on the revision acts on its props, and the model hears the update first",
    !acted.error && heard.at(-1).includes(`[UI update] ${first} was replaced by ${second}`) &&
      heard.at(-1).indexOf("[UI update]") < heard.at(-1).indexOf("noted x at 389"),
  );

  // ── an earlier handle names the surface as it is now; the app's sentence goes first
  const { handle: third } = await hai.update(id, card, first, { price: 401 }, { model: "Fares moved." });
  c = await peek(id);
  check("an update naming an earlier handle revises the latest", c.superseded?.[second] === third && c.superseded?.[first] === second);
  check(
    "the app's sentence goes before what the model always hears",
    (await updates(id)).at(-1).model === `Fares moved. ${second} was replaced by ${third}; its earlier digest is out of date. Now: card 401 as ${third}`,
  );

  // ── a turn in progress lands first; past the timeout, ConversationBusy
  const held = await store.loadConversation(id);
  const waited = failed(hai.update(id, card, third, { price: 402 }));
  await wait(150);
  held.leaseUntil = null;
  await store.saveConversation(held);
  const after = await waited;
  c = await peek(id);
  check("an update waits for a turn holding the conversation, then lands", after === null && c.superseded?.[third] === c.handles.at(-1));
  const fourth = c.handles.at(-1);
  const holding = await store.loadConversation(id);
  const started = Date.now();
  const busy = await failed(hai.update(id, card, fourth, { price: 403 }, { timeoutMs: 200 }));
  check(
    `…and past its timeoutMs throws ConversationBusy (${busy?.name}, ${Date.now() - started}ms)`,
    isConversationBusy(busy) && Date.now() - started >= 200 && Date.now() - started < 2_000,
  );
  check("…having changed nothing", (await updates(id)).length === 3 && !holding.superseded?.[fourth]);

  // ── bursts coalesce: one write in flight, the newest waiting behind it
  const burst = Promise.allSettled([
    hai.update(id, card, fourth, { price: 501 }),
    hai.update(id, card, fourth, { price: 502 }, { wake: true }),
    hai.update(id, card, fourth, { price: 503 }),
  ]);
  await wait(150);
  holding.leaseUntil = null;
  await store.saveConversation(holding);
  const written = (await burst).map((r) => r.value ?? { handle: r.reason?.message });
  c = await peek(id);
  const burstNotices = (await updates(id)).slice(3);
  const last = await store.getPayload(c.handles.at(-1), id);
  check(
    `a burst writes the one in flight and the newest, not every call (${burstNotices.length} writes)`,
    burstNotices.length === 2 && last.props.price === 503 && (await store.getPayload(written[0].handle, id)).props.price === 501,
  );
  check(
    "…and the call the newest replaced resolves to what it wrote",
    written[1].handle === written[2].handle && written[2].handle === c.handles.at(-1) && written[0].handle !== written[1].handle,
  );
  check("…and a wake any of them asked for still wakes", burstNotices[1].kind === "wake" && burstNotices[0].kind === undefined);
  // it wakes as a wake notice does
  const woke = [];
  const outcome = await hai.wake(id, (e) => woke.push(e));
  c = await peek(id);
  check(
    `an update sent with wake starts a turn whose message carries the update (${outcome})`,
    outcome === "woke" && heard.at(-1).includes(`was replaced by ${written[2].handle}`) && heard.at(-1).includes("The user has not said anything"),
  );

  // ── refusals, before anything is written
  const writes = (await store.getNotices(id, 0)).length;
  check("an unregistered surface is refused", /not registered/.test((await failed(hai.update(id, stray, first, {})))?.message ?? ""));
  check("props that fail the surface's schema are refused", /price must be a number/.test((await failed(hai.update(id, card, first, { price: "x" })))?.message ?? ""));
  check("a handle the conversation never showed is refused", /no surface ui_nope/.test((await failed(hai.update(id, card, "ui_nope", { price: 1 })))?.message ?? ""));
  check("a surface of another contract is refused", /is a card, not a pick/.test((await failed(hai.update(id, picker, first, { v: 1 })))?.message ?? ""));
  const unknown = await failed(hai.update("conv_nope", card, first, { price: 1 }));
  check("an unknown conversation is refused, and not created", /no conversation conv_nope/.test(unknown?.message ?? "") && (await store.getNotices("conv_nope", 0)) === null);
  check("a negative timeoutMs is refused", (await failed(hai.update(id, card, first, { price: 1 }, { timeoutMs: -1 }))) instanceof RangeError);
  const plain = createHai({ model, store, tools: [tool], surfaces: [card], system: "x" });
  check(
    "an app that didn't say it sends updates is refused: no browser would hear them",
    /updates: true/.test((await failed(plain.update(id, card, first, { price: 1 })))?.message ?? ""),
  );
  // its events stream is open, but nothing would start the turn a wake update asks for
  const passive = defineNotice({ name: "passive", version: 1, payload: any }).implement({ model: () => null });
  const noticesOnly = createHai({ model, store, tools: [tool], surfaces: [card], notices: [passive], system: "x" });
  check(
    "…and so is one that only lists passive notices",
    !noticesOnly.wakes && /updates: true/.test((await failed(noticesOnly.update(id, card, first, { price: 1 })))?.message ?? ""),
  );
  check("…and none of those wrote anything", (await store.getNotices(id, 0)).length === writes);

  // ── a notice that can't be stored undoes the revision
  c = await peek(id);
  const before = { handles: c.handles.length, superseded: JSON.stringify(c.superseded) };
  failNotice = true;
  const lost = await failed(hai.update(id, card, first, { price: 600 }));
  failNotice = false;
  c = await peek(id);
  check(
    `a revision whose notice can't be stored is undone, and the conversation let go (${lost?.message})`,
    lost?.message === "notice store down" && c.handles.length === before.handles && JSON.stringify(c.superseded) === before.superseded,
  );

  // ── a question waiting on the surface waits on its revision
  next.push({ op: "ask", v: "B" });
  const asking = await request(undefined, say("ask"));
  const qid = asking.c.id;
  const question = asking.c.pending?.handle;
  const { handle: revisedQuestion } = await hai.update(qid, picker, question, { v: "C" });
  c = await peek(qid);
  check("a question waiting on the surface waits on its revision", c.pending?.handle === revisedQuestion && c.status === "awaiting");
  const answered = await request(qid, click(revisedQuestion, "choose", "C"));
  const answer = JSON.stringify(answered.c.messages.at(-2)?.content ?? "");
  check(
    "…and its answer goes out under the digest the model saw, with the update after it",
    !answered.error && answer.includes(`pick B as ${question}\\nchose C from C`) &&
      answer.indexOf("chose C from C") < answer.indexOf(`[UI update] ${question} was replaced by ${revisedQuestion}`),
  );
  check("an answered surface can't be revised", /was answered/.test((await failed(hai.update(qid, picker, question, { v: "D" })))?.message ?? ""));

  // ── an out-of-date conversation stays out of date
  next.push({ op: "brief", price: 10 });
  const short = await request(undefined, say("show"));
  await wait(1_050);
  const expired = await failed(hai.update(short.c.id, brief, short.c.handles[0], { price: 11 }));
  c = await peek(short.c.id);
  check(
    `a revision can't bring an out-of-date conversation back (${expired?.message})`,
    expired?.message === "this conversation is out of date; nothing more can be revised in it" && !c.superseded?.[short.c.handles[0]],
  );
  // …nor one that goes out of date while the revision is made
  next.push({ op: "brief", price: 20 });
  const lapsing = await request(undefined, say("show"));
  slowPut = 1_050; // the write outlasts the window that was open when the update began
  const slow = await failed(hai.update(lapsing.c.id, brief, lapsing.c.handles[0], { price: 21 }));
  slowPut = 0;
  c = await peek(lapsing.c.id);
  check(
    `a revision whose surface goes out of date while it is made is not applied (${slow?.message})`,
    /went out of date while the revision was made/.test(slow?.message ?? "") && !c.superseded?.[lapsing.c.handles[0]] &&
      c.handles.length === 1 && (await updates(lapsing.c.id)).length === 0,
  );
}

// ── hai.update reaches the browser through the events stream ───────────
async function updateStreamChecks() {
  console.log("\nupdates on the events stream");
  const http = await import("node:http");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineSurface, defineTool } = await import("../packages/core/dist/index.js");
  const { createChat } = await import("../packages/client/src/index.js");
  const any = { parse: (v) => v };
  const card = defineSurface({ name: "card", version: 1, props: any }).implement({
    digest: (p, { handle }) => `card ${p.price} as ${handle}`,
    actions: {},
    queries: {},
    staleAfterMs: 60_000,
  });
  const show = defineTool({ name: "show", description: "d", input: any, inputJsonSchema: { type: "object" }, run: (_i, ctx) => ctx.render(card, { price: 343 }) });
  let replies = 0;
  const model = {
    id: "stub",
    async generate({ messages, onTextDelta }) {
      const last = messages.at(-1).content;
      if (typeof last === "string" && last === "show") {
        return { content: [{ type: "tool_use", id: `tu_${Math.random()}`, name: "show", input: {} }], stop_reason: "tool_use" };
      }
      replies++;
      onTextDelta(`reply ${replies}`);
      return { content: [{ type: "text", text: `reply ${replies}` }], stop_reason: "end_turn" };
    },
  };
  const memory = memoryStore();
  const hidden = new Set(); // payloads read back as gone, as if swept
  const store = { ...memory, getPayload: (h, id) => (hidden.has(h) ? Promise.resolve(null) : memory.getPayload(h, id)) };
  const hai = createHai({ model, store, tools: [show], surfaces: [card], system: "x", updates: true });
  const handler = nodeHandler(hai, "/hai");
  const streams = new Set();
  const resumes = []; // each events request's Last-Event-ID
  const server = http.createServer(async (req, res) => {
    if (req.url.includes("/events")) {
      resumes.push(req.headers["last-event-id"]);
      streams.add(res);
      res.on("close", () => streams.delete(res));
    }
    if (!(await handler(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5393, "127.0.0.1", r));
  const base = "http://127.0.0.1:5393";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 3_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (cond()) return true;
    return cond();
  };
  async function read(url, headers = {}, enough = Infinity, ms = 600) {
    const aborter = new AbortController();
    // once more if a kept-alive socket was closed under it
    const res = await fetch(url, { headers, signal: aborter.signal }).catch(() => fetch(url, { headers, signal: aborter.signal }));
    const frames = [];
    const timer = setTimeout(() => aborter.abort(), ms);
    try {
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (frames.length < enough) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const lines = buffer.slice(0, i).split("\n");
          buffer = buffer.slice(i + 2);
          const data = lines.find((l) => l.startsWith("data: "));
          const id = lines.find((l) => l.startsWith("id: "))?.slice(4);
          // an id alone, with no event, still moves the browser's place on
          if (data || id) frames.push({ id, event: data ? JSON.parse(data.slice(6)) : null });
        }
      }
    } catch {}
    clearTimeout(timer);
    aborter.abort();
    return frames;
  }
  const el = () => ({ replaceChildren() {}, dataset: {}, textContent: "", className: "" });
  const mounts = [];
  const updated = [];
  const registry = { card: { mount: (_el, props) => (mounts.push(props), { update: (p) => updated.push(p), unmount() {} }) } };

  try {
    // ── the route
    const chat = await fetch(`${base}/hai/chat`, { method: "POST", body: JSON.stringify({ message: "show" }) }).then((r) => r.text());
    const hello = JSON.parse(chat.split("\n").find((l) => l.startsWith("data: ")).slice(6));
    check("an app that sends updates tells the browser to open the events stream", hello.events === true);
    const id = hello.conversationId;
    const first = JSON.parse(chat.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).find((l) => l.includes('"ui_open"'))).handle;
    const madeAt = Date.now();
    const { handle: second } = await hai.update(id, card, first, { price: 389 });
    const frames = await read(`${base}/hai/events?conversationId=${id}`, {}, 2);
    const [open, props] = frames;
    const [notice] = await store.getNotices(id, 0);
    check(
      "an update notice goes out as the revision's ui_open, saying what it replaces, and its props",
      frames.length === 2 && open.event.type === "ui_open" && open.event.handle === second && open.event.replaces === first &&
        open.event.component === "card" && open.event.mode === "display" && open.event.staleAfterMs === 60_000 &&
        props.event.type === "ui_props" && props.event.handle === second && props.event.props.price === 389,
    );
    check(
      `…with how long ago it was stored (${open.event.ageMs}ms), and no model text`,
      typeof open.event.ageMs === "number" && open.event.ageMs >= 0 && open.event.ageMs <= Date.now() - madeAt &&
        !JSON.stringify(frames).includes("replaced by"),
    );
    check("…and only its last frame carries the notice's id", open.id === undefined && props.id === String(notice.seq));
    const resumed = await read(`${base}/hai/events?conversationId=${id}`, { "last-event-id": props.id }, 1, 300);
    check("a stream resuming after it doesn't send it again", resumed.length === 0);
    const { handle: third } = await hai.update(id, card, second, { price: 390 });
    hidden.add(third);
    const swept = await read(`${base}/hai/events?conversationId=${id}`, { "last-event-id": props.id }, 1, 300);
    hidden.delete(third);
    const sweptSeq = (await store.getNotices(id, 0)).at(-1).seq;
    check(
      "a revision whose payload is gone is passed over, with its id alone, so a browser resumes after it",
      swept.length === 1 && swept[0].event === null && swept[0].id === String(sweptSeq),
    );

    // ── the client
    const client = createChat({ endpoint: `${base}/hai`, registry });
    await client.send("show");
    const cid = client.state.conversationId;
    const shownHandle = [...client.state.surfaces.keys()][0];
    client.mount(shownHandle, el());
    const record = client.state.surfaces.get(shownHandle);
    await until(() => streams.size === 1);
    await wait(300); // the deadline of a revision must not count from this request
    const sent = Date.now();
    const { handle: revised } = await hai.update(cid, card, shownHandle, { price: 401 });
    check("the client swaps the revision into the surface on screen", await until(() => client.state.surfaces.get(revised) === record));
    check(
      "…through its update, mounted once, with the transcript's block moved on",
      mounts.length === 1 && updated.length === 1 && updated[0].price === 401 &&
        client.state.blocks.filter((b) => b.kind === "ui").map((b) => b.handle).join() === revised,
    );
    check(
      `…its deadline counted from when it was stored, not from the last request (${record.deadline - sent - 60_000}ms)`,
      record.deadline >= sent + 60_000 - 50,
    );
    const seq = (await store.getNotices(cid, 0)).at(-1).seq;
    resumes.length = 0;
    for (const res of streams) res.destroy();
    const reconnected = await until(() => resumes.length > 0, 10_000);
    check(
      `a reconnect resumes after the update notice, which isn't a notice frame (${resumes[0]})`,
      reconnected && resumes[0] === String(seq),
    );

    // ── an update with wake starts a turn where the browser is watching
    await until(() => streams.size === 1);
    const before = replies;
    await hai.update(cid, card, revised, { price: 402 }, { wake: true });
    check(
      "an update sent with wake starts a turn the watching browser shows",
      await until(() => client.state.blocks.some((b) => b.kind === "assistant" && b.text === `reply ${before + 1}`)),
    );
    client.close();

    // ── an update that loses the conversation part way leaves no notice behind
    const lapsing = memoryStore({ leaseMs: 200 });
    let slowPut = false;
    const slowStore = {
      ...lapsing,
      putPayload: async (record, token) => {
        const handle = await lapsing.putPayload(record, token);
        if (slowPut) await wait(300); // long enough for the lease to lapse and be taken
        return handle;
      },
    };
    const lapsingHai = createHai({ model, store: slowStore, tools: [show], surfaces: [card], system: "x", updates: true });
    const c = await slowStore.loadConversation(undefined);
    await lapsingHai.send(c, "show", () => {});
    c.leaseUntil = null;
    await slowStore.saveConversation(c);
    slowPut = true;
    const losing = lapsingHai.update(c.id, card, c.handles[0], { price: 999 }).then(() => null, (err) => err);
    await wait(250);
    const taker = await slowStore.loadConversation(c.id); // takes the lapsed lease over
    const lostErr = await losing;
    slowPut = false;
    taker.leaseUntil = null;
    await slowStore.saveConversation(taker);
    check(
      `an update overtaken before it commits throws StaleLease, and appends no notice (${lostErr?.name})`,
      lostErr?.name === "StaleLease" && (await slowStore.getNotices(c.id, 0)).length === 0 && !taker.superseded?.[c.handles[0]],
    );
  } finally {
    for (const res of streams) res.destroy();
    server.close();
  }
}

async function noticeStreamChecks() {
  console.log("\nnotice stream");
  const http = await import("node:http");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineNotice, defineSurface, defineTool } = await import("../packages/core/dist/index.js");
  const { createChat } = await import("../packages/client/src/index.js");
  const any = { parse: (v) => v };
  const held = defineNotice({ name: "held", version: 1, payload: any }).implement({ model: (p) => `secret ${p.flight}` });
  const card = defineSurface({ name: "card", version: 1, props: any }).implement({ digest: () => "a card", actions: {}, queries: {} });
  // set to have the tool send a notice about its own surface as it shows it
  let noticeFromTool = null;
  const show = defineTool({
    name: "show",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    async run(_i, ctx) {
      const shownCard = await ctx.render(card, {});
      if (noticeFromTool) await hai.notify(ctx.conversationId, held, noticeFromTool, { handle: shownCard.handle });
      return shownCard;
    },
  });
  let shown = false;
  const model = {
    id: "stub",
    async generate() {
      if (!shown) {
        shown = true;
        return { content: [{ type: "tool_use", id: "tu_1", name: "show", input: {} }], stop_reason: "tool_use" };
      }
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  // every limit the events route reads notices with
  const limits = [];
  const memory = memoryStore();
  const store = { ...memory, getNotices: (id, after, limit) => (limits.push(limit), memory.getNotices(id, after, limit)) };
  const hai = createHai({ model, store, tools: [show], surfaces: [card], notices: [held], system: "x" });
  const plain = createHai({ model, store: memoryStore(), tools: [], surfaces: [], system: "x" });
  const withNotices = nodeHandler(hai, "/hai");
  const without = nodeHandler(plain, "/plain");
  // every events response still open, so a test can drop them all
  const streams = new Set();
  // set to hold a chat's whole response back until a while after it ends, as
  // a buffering proxy might, so its frames reach the client late
  let holdChat = false;
  const server = http.createServer(async (req, res) => {
    if (req.url.includes("/events")) {
      streams.add(res);
      res.on("close", () => streams.delete(res));
    }
    if (holdChat && req.url.endsWith("/chat")) {
      const chunks = [];
      const write = res.write.bind(res);
      const end = res.end.bind(res);
      res.write = (chunk) => (chunks.push(chunk), true);
      res.end = (chunk) => {
        if (chunk) chunks.push(chunk);
        setTimeout(() => (chunks.forEach((c) => write(c)), end()), 300);
        return res;
      };
    }
    if (!(await withNotices(req, res)) && !(await without(req, res))) res.writeHead(404).end("not handled");
  });
  await new Promise((r) => server.listen(5379, "127.0.0.1", r));
  const base = "http://127.0.0.1:5379";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // the surface a conversation's turn rendered, read the way a turn would
  const firstHandle = async (id) => {
    const c = await store.loadConversation(id);
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c.handles[0];
  };
  const until = async (cond, ms = 2_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (cond()) return true;
    return cond();
  };

  // Read an events stream for `ms`, or until `enough` frames: each frame's id
  // and event.
  async function read(url, headers = {}, enough = Infinity, ms = 600) {
    const aborter = new AbortController();
    const res = await fetch(url, { headers, signal: aborter.signal });
    const frames = [];
    if (!res.ok) return { status: res.status, frames };
    const timer = setTimeout(() => aborter.abort(), ms);
    try {
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (frames.length < enough) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const lines = buffer.slice(0, i).split("\n");
          buffer = buffer.slice(i + 2);
          const data = lines.find((l) => l.startsWith("data: "));
          if (data) frames.push({ id: lines.find((l) => l.startsWith("id: "))?.slice(4), event: JSON.parse(data.slice(6)) });
        }
      }
    } catch {}
    clearTimeout(timer);
    aborter.abort();
    return { status: res.status, frames };
  }

  try {
    // ── the route
    const chat = await fetch(`${base}/hai/chat`, { method: "POST", body: JSON.stringify({ message: "hi" }) }).then((r) => r.text());
    const hello = JSON.parse(chat.split("\n").find((l) => l.startsWith("data: ")).slice(6));
    const id = hello.conversationId;
    check("hello tells the browser to open the events stream", hello.events === true);
    const plainHello = await fetch(`${base}/plain/chat`, { method: "POST", body: JSON.stringify({ message: "hi" }) }).then((r) => r.text());
    check("…and says nothing of it when the app sends no notices", !plainHello.includes('"events"'));
    check("an app with no notices has no events route", (await fetch(`${base}/plain/events?conversationId=conv_1`)).status === 404 &&
      (await fetch(`${base}/plain/events?conversationId=conv_1`).then((r) => r.text())) === "not handled");
    check("an unknown conversation's stream is refused", (await read(`${base}/hai/events?conversationId=conv_nope`)).status === 404);

    const handle = await firstHandle(id);
    await hai.notify(id, held, { flight: "AC832" }, { handle });
    await hai.notify(id, held, { flight: "NH7" });
    const backlog = await read(`${base}/hai/events?conversationId=${id}`, {}, 2);
    check(
      "the stream starts with every notice sent before it opened, each with its seq as its id",
      backlog.frames.length === 2 && backlog.frames.every((f) => f.id === String(f.event.seq)) &&
        backlog.frames[0].event.type === "notice" && backlog.frames[0].event.handle === handle &&
        backlog.frames[0].event.payload.flight === "AC832" && backlog.frames[0].event.name === "held",
    );
    check("the model's half is not on the events stream", !JSON.stringify(backlog.frames).includes("secret"));
    const resumed = await read(`${base}/hai/events?conversationId=${id}`, { "last-event-id": backlog.frames[0].id }, 1);
    check("Last-Event-ID resumes after the last notice seen", resumed.frames.length === 1 && resumed.frames[0].event.payload.flight === "NH7");
    // nothing to catch up on: the stream still opens at once, not at the first heartbeat
    const opening = Date.now();
    const quiet = await Promise.race([
      fetch(`${base}/hai/events?conversationId=${id}&after=${backlog.frames[1].id}`),
      wait(2_000).then(() => null),
    ]);
    check(`a stream with nothing to send yet opens at once (${Date.now() - opening}ms)`, quiet?.status === 200);
    await quiet?.body.cancel();
    const live = read(`${base}/hai/events?conversationId=${id}`, { "last-event-id": backlog.frames[1].id }, 1, 2_000);
    await wait(100);
    await hai.notify(id, held, { flight: "JL1" });
    const arrived = await live;
    check("a notice sent while the stream is open arrives on it", arrived.frames[0]?.event.payload.flight === "JL1");
    await until(() => streams.size === 0);
    check("a stream the browser closes is let go of", streams.size === 0);

    // ── a long backlog goes out a page at a time
    for (let i = 0; i < 250; i++) await hai.notify(id, held, { flight: `F${i}` });
    limits.length = 0;
    const lastSeen = arrived.frames[0].id;
    const long = await read(`${base}/hai/events?conversationId=${id}`, { "last-event-id": lastSeen }, 250, 3_000);
    check(
      "a backlog of 250 arrives whole, in order",
      long.frames.length === 250 && long.frames.every((f, i) => f.event.payload.flight === `F${i}`),
    );
    check(
      "…read from the store in pages, never all at once",
      limits.length >= 3 && limits.every((limit) => Number.isInteger(limit) && limit > 0 && limit <= 100),
    );

    // ── a reader that stops reading cannot make the server buffer everything
    const stalled = new AbortController();
    const response = await fetch(`${base}/hai/events?conversationId=${id}&after=${long.frames.at(-1).id}`, {
      signal: stalled.signal,
    }); // and never read
    await until(() => streams.size === 1);
    const [backedUp] = streams;
    const bulk = "x".repeat(64 * 1024);
    for (let i = 0; i < 200; i++) await hai.notify(id, held, { flight: `B${i}`, bulk });
    let buffered = 0;
    for (let i = 0; i < 50; i++, await wait(20)) buffered = Math.max(buffered, backedUp.writableLength);
    check(
      `the server buffers little for a reader that has stopped (${Math.round(buffered / 1024)} KiB of 12.5 MiB sent)`,
      buffered < 1024 * 1024,
    );
    stalled.abort();
    void response;
    check("…and lets go of it when it leaves", await until(() => streams.size === 0));

    // ── the client
    // a notice component that returns nothing from mount
    const client = createChat({ endpoint: `${base}/hai`, registry: {}, notices: { held: { mount() {} } } });
    shown = false; // its first turn shows a card too
    await client.send("hello again"); // joins no conversation: a new one
    const cid = client.state.conversationId;
    check("the client opens the events stream when hello says to", await until(() => streams.size === 1));
    const ch = await firstHandle(cid);
    await hai.notify(cid, held, { flight: "UA9" });
    await hai.notify(cid, held, { flight: "DL5" }, { handle: ch });
    check("notices arrive in the client's state", await until(() => client.state.notices.length === 2));
    const slot = { textContent: "", className: "", replaceChildren() {} };
    check(
      "mountNotice() answers null, not undefined, for a component that returns nothing",
      client.mountNotice(client.state.notices[0].seq, slot) === null,
    );
    const kinds = client.state.blocks.map((b) => (b.kind === "notice" ? `notice:${b.payload.flight}` : b.kind));
    const ui = kinds.indexOf("ui");
    check(
      "a notice naming a surface sits after it; one that names none goes at the end",
      kinds[ui + 1] === "notice:DL5" && kinds.at(-1) === "notice:UA9",
    );
    // the connection drops; the client reconnects and resumes after DL5
    for (const res of streams) res.destroy();
    await hai.notify(cid, held, { flight: "BA2" });
    check("after a dropped connection, the client reconnects and catches up", await until(() => client.state.notices.length === 3, 4_000));
    check(
      "…with nothing shown twice",
      new Set(client.state.notices.map((n) => n.seq)).size === client.state.notices.length,
    );
    // a notice that beats its surface to the client moves under it once it opens
    const order = [];
    const stop = client.subscribe((_s, event) => order.push(event.type));
    shown = false;
    noticeFromTool = { flight: "EARLY" };
    holdChat = true;
    await client.send("show another");
    holdChat = false;
    noticeFromTool = null;
    stop();
    const early = client.state.blocks.findIndex((b) => b.kind === "notice" && b.payload.flight === "EARLY");
    const lastUi = client.state.blocks.findLastIndex((b) => b.kind === "ui");
    check("(the notice really did arrive before its surface opened)", order.indexOf("notice") < order.indexOf("ui_open"));
    check("a notice that arrives before its surface sits under it once it opens", early === lastUi + 1);

    client.reset();
    check("reset() closes the stream", await until(() => streams.size === 0));
    check("…and forgets the old conversation's notices", client.state.notices.length === 0);
    client.close();
  } finally {
    for (const res of streams) res.destroy();
    server.close();
  }

  // ── a watch that never wakes cannot keep a notice from the browser
  {
    const memory = memoryStore();
    const deaf = {
      ...memory,
      // listens, and never says a word: a lost NOTIFY, a dropped LISTEN
      async *watch(_id, signal) {
        await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
      },
    };
    const quietHai = createHai({ model, store: deaf, tools: [], surfaces: [], notices: [held], system: "x" });
    const quietHandler = nodeHandler(quietHai, "/hai");
    const quietServer = http.createServer(async (req, res) => {
      if (!(await quietHandler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => quietServer.listen(5381, "127.0.0.1", r));
    try {
      const c = await deaf.loadConversation(undefined);
      c.leaseUntil = null;
      await deaf.saveConversation(c);
      const reading = read(`http://127.0.0.1:5381/hai/events?conversationId=${c.id}`, {}, 1, 4_000);
      await wait(200);
      const sentAt = Date.now();
      await quietHai.notify(c.id, held, { flight: "LOST" });
      const got = await reading;
      check(
        `a notice whose wake-up never comes still arrives, on the next read (${((Date.now() - sentAt) / 1000).toFixed(1)}s)`,
        got.frames[0]?.event.payload.flight === "LOST",
      );
    } finally {
      quietServer.close();
    }
  }

  // ── a conversation deleted under an open stream ends it
  {
    const memory = memoryStore();
    let deleted = false;
    const vanishing = { ...memory, getNotices: async (...args) => (deleted ? null : memory.getNotices(...args)) };
    const goneHai = createHai({ model, store: vanishing, tools: [], surfaces: [], notices: [held], system: "x" });
    const goneHandler = nodeHandler(goneHai, "/hai");
    const goneServer = http.createServer(async (req, res) => {
      if (!(await goneHandler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => goneServer.listen(5382, "127.0.0.1", r));
    try {
      const c = await memory.loadConversation(undefined);
      c.leaseUntil = null;
      await memory.saveConversation(c);
      const res = await fetch(`http://127.0.0.1:5382/hai/events?conversationId=${c.id}`);
      const ended = res.text().then(() => true);
      deleted = true;
      const result = await Promise.race([ended, wait(4_000).then(() => false)]);
      check("a stream whose conversation is deleted ends, at the next read", result === true);
    } finally {
      goneServer.close();
    }
  }

  // ── a stream that keeps dropping backs off, though each attempt gets a 200
  const attempts = [];
  const flaky = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (req.url.includes("/events")) {
      attempts.push(Date.now());
      return void res.end(); // up, then straight back down
    }
    req.resume();
    req.on("end", () => {
      res.write(`data: ${JSON.stringify({ type: "hello", conversationId: "conv_1", model: "m", events: true })}\n\n`);
      res.end(`data: ${JSON.stringify({ type: "status", status: "idle" })}\n\n`);
    });
  });
  await new Promise((r) => flaky.listen(5380, "127.0.0.1", r));
  const dropping = createChat({ endpoint: "http://127.0.0.1:5380/hai", registry: {} });
  try {
    await dropping.send("hi");
    await until(() => attempts.length >= 3, 6_000);
    const gaps = attempts.slice(1, 3).map((t, i) => t - attempts[i]);
    check(
      `each drop waits longer before the next try (${gaps.map((g) => `${(g / 1000).toFixed(1)}s`).join(", ")})`,
      gaps.length === 2 && gaps[0] >= 900 && gaps[1] >= 1_800,
    );
    // the chat is now waiting out a backoff (once its timer is set, a moment
    // after the server saw the attempt); closing it ends that wait, timer and all
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const idle = await (async () => {
      for (let i = 0; i < 200 && timers() < 1; i++) await new Promise((r) => setImmediate(r));
      return timers();
    })();
    const waiting = idle;
    dropping.close();
    await wait(0);
    check(`close() during a backoff lets go of its timer (${waiting} → ${timers()})`, timers() === waiting - 1);
  } finally {
    dropping.close();
    flaky.close();
  }
}

// ── a wake turn runs where a browser watches, and the client waits for it ─
async function wakeStreamChecks() {
  console.log("\nwake stream");
  const http = await import("node:http");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineNotice } = await import("../packages/core/dist/index.js");
  const { createChat } = await import("../packages/client/src/index.js");
  const any = { parse: (v) => v };
  const dropped = defineNotice({ name: "dropped", version: 1, kind: "wake", payload: any }).implement({
    model: (p) => `${p.flight} is cheaper.`,
  });
  let slow = 0; // how long the model takes to answer a wake turn
  const asked = []; // what each model call was answering
  const model = {
    id: "stub",
    async generate({ messages, onTextDelta }) {
      const last = messages.at(-1).content;
      const text = typeof last === "string" ? last : last.at(-1).text;
      asked.push(text);
      if (text.startsWith("[The user has not said anything")) await new Promise((r) => setTimeout(r, slow));
      const reply = text.startsWith("[The user") ? "Heads up: cheaper." : `You said ${text}.`;
      onTextDelta(reply);
      return { content: [{ type: "text", text: reply }], stop_reason: "end_turn" };
    },
  };
  // set to make each save take this long, as a slow database would, or to
  // fail the save that ends a wake turn
  let slowSave = 0;
  let failWakeSave = false;
  let onLoad = null; // called once by the next conversation load
  const memory = memoryStore();
  const store = {
    ...memory,
    async loadConversation(id) {
      const c = await memory.loadConversation(id);
      const call = onLoad;
      onLoad = null;
      call?.();
      return c;
    },
    async saveConversation(c) {
      if (slowSave) await new Promise((r) => setTimeout(r, slowSave));
      const woke = c.messages.at(-1)?.role === "assistant" && c.messages.at(-2)?.content?.at?.(-1)?.text?.startsWith("[The user");
      if (failWakeSave && woke) throw new Error("database away");
      return memory.saveConversation(c);
    },
  };
  const hai = createHai({ model, store, tools: [], surfaces: [], notices: [dropped], system: "x", maxWakes: { count: 100, perMs: 60_000 } });
  const handler = nodeHandler(hai, "/hai");
  const posts = []; // every POST, and how it was answered
  const streams = new Set(); // events responses still open
  const server = http.createServer(async (req, res) => {
    if (req.url.includes("/events")) {
      streams.add(res);
      res.on("close", () => streams.delete(res));
    }
    if (req.method === "POST") {
      const at = posts.push({ path: req.url, status: null }) - 1;
      res.on("finish", () => (posts[at].status = res.statusCode));
    }
    if (!(await handler(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5383, "127.0.0.1", r));
  const base = "http://127.0.0.1:5383";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 3_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (cond()) return true;
    return cond();
  };
  // events read off one stream until `done`, or `ms`
  async function stream(url, done, ms = 3_000, headers = {}) {
    const aborter = new AbortController();
    const got = [];
    const timer = setTimeout(() => aborter.abort(), ms);
    try {
      const res = await fetch(url, { headers, signal: aborter.signal });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (!done(got)) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buffer = buffer.slice(i + 2);
          if (line) got.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {}
    clearTimeout(timer);
    aborter.abort();
    return got;
  }
  const finished = (got) => got.some((e) => e.type === "status" && e.status === "idle");
  const begin = async () => {
    const c = await store.loadConversation(undefined);
    c.messages.push({ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c.id;
  };

  try {
    // ── a wake notice while the browser watches: the turn comes down the stream
    const id = await begin();
    const watching = stream(`${base}/hai/events?conversationId=${id}`, finished);
    await wait(100);
    await hai.notify(id, dropped, { flight: "AC832" });
    const got = await watching;
    const kinds = got.map((e) => e.type);
    check(
      "a wake notice's turn streams after it, on the events stream",
      kinds[0] === "notice" && kinds.includes("text_delta") && finished(got) &&
        got.filter((e) => e.type === "text_delta").map((e) => e.text).join("") === "Heads up: cheaper.",
    );

    // ── busy: the route tries again until the conversation is free
    const holder = await store.loadConversation(id);
    const retrying = stream(`${base}/hai/events?conversationId=${id}`, finished, 4_000, { "last-event-id": String(got[0].seq) });
    await wait(100);
    await hai.notify(id, dropped, { flight: "NH7" });
    await wait(600);
    holder.leaseUntil = null;
    await store.saveConversation(holder);
    check("a wake notice that lands while the conversation is busy wakes once it is free", finished(await retrying));

    // ── nobody watching: the turn waits for a browser to connect. This one
    // resumes past the notice, already shown before it went away, so only the
    // check on connecting can start the turn.
    const later = await begin();
    const { seq: missed } = await hai.notify(later, dropped, { flight: "JL1" });
    await wait(200);
    const untouched = asked.length;
    const connected = await stream(`${base}/hai/events?conversationId=${later}`, finished, 3_000, { "last-event-id": String(missed) });
    check(
      "with nobody watching no turn runs; the first browser to connect starts it",
      untouched === asked.length - 1 && finished(connected),
    );

    // ── every stream on this process hears the turn, not only the one that ran it
    const shared = await begin();
    const tabA = stream(`${base}/hai/events?conversationId=${shared}`, (got) => got.some((e) => e.type === "released"), 4_000);
    const tabB = stream(`${base}/hai/events?conversationId=${shared}`, (got) => got.some((e) => e.type === "released"), 4_000);
    await wait(150);
    slow = 600;
    await hai.notify(shared, dropped, { flight: "TWO" });
    await wait(200); // the turn is under way
    const lateTab = stream(`${base}/hai/events?conversationId=${shared}`, (got) => got.some((e) => e.type === "released"), 4_000);
    const [a, b, late] = await Promise.all([tabA, tabB, lateTab]);
    slow = 0;
    const replied = (got) => got.filter((e) => e.type === "text_delta").map((e) => e.text).join("") === "Heads up: cheaper.";
    check(
      "two tabs on one conversation both see a wake turn's reply, and both hear it let go",
      replied(a) && replied(b) && a.some((e) => e.type === "released") && b.some((e) => e.type === "released"),
    );
    check(
      "a tab that connects during a wake turn is told one is running, then that it let go",
      late.findIndex((e) => e.type === "status" && e.status === "streaming") >= 0 &&
        late.findIndex((e) => e.type === "status" && e.status === "streaming") < late.findIndex((e) => e.type === "released"),
    );

    // ── a stream that joins part way gets the reply so far, then the rest
    {
      const joined = await begin();
      const halves = { first: "Heads up: ", rest: "it got cheaper." };
      const parts = [];
      const partial = {
        id: "halves",
        async generate({ onTextDelta }) {
          onTextDelta(halves.first);
          parts.push("first");
          await new Promise((r) => setTimeout(r, 600));
          onTextDelta(halves.rest);
          return { content: [{ type: "text", text: halves.first + halves.rest }], stop_reason: "end_turn" };
        },
      };
      const original = model.generate;
      model.generate = (req) => {
        const last = req.messages.at(-1).content;
        return typeof last !== "string" && last.at(-1).text.startsWith("[The user") ? partial.generate(req) : original(req);
      };
      const first = stream(`${base}/hai/events?conversationId=${joined}`, (got) => got.some((e) => e.type === "released"), 4_000);
      await wait(150);
      await hai.notify(joined, dropped, { flight: "HALF" });
      await until(() => parts.length === 1); // the first half has been said
      const late = await stream(`${base}/hai/events?conversationId=${joined}`, (got) => got.some((e) => e.type === "released"), 4_000);
      await first;
      model.generate = original;
      const opened = late.find((e) => e.type === "block_start" && e.block.kind === "assistant");
      const said = (opened?.block.text ?? "") + late.filter((e) => e.type === "text_delta" && e.id === opened?.block.id).map((e) => e.text).join("");
      check(
        "a stream that joins mid-reply gets the text so far in one block, then the rest",
        opened?.block.text === halves.first && said === halves.first + halves.rest,
      );
    }

    // ── the client: a message sent during a wake turn waits for it, rather than 409
    const chat = createChat({ endpoint: `${base}/hai`, registry: {} });
    await chat.send("first");
    const cid = chat.state.conversationId;
    await wait(150); // the events stream opens on hello
    slow = 400;
    await hai.notify(cid, dropped, { flight: "UA9" });
    check("the client sees the wake turn start", await until(() => chat.state.status === "streaming"));
    posts.length = 0;
    const sent = await chat.send("during");
    check(
      "a message sent during a wake turn waits for it, and goes through",
      sent === true && posts.every((p) => p.status !== 409) && !chat.state.blocks.some((b) => b.kind === "error"),
    );
    check("…after the wake turn's reply", asked.at(-1) === "during" && asked.at(-2).startsWith("[The user"));
    check(
      "the wake turn's reply sits under its notice in the transcript",
      chat.state.blocks.findIndex((b) => b.kind === "notice") < chat.state.blocks.findIndex((b) => b.kind === "assistant" && b.text === "Heads up: cheaper."),
    );

    // The turn says it is idle before its save lets the conversation go. A
    // message sent on that would still find it held: the client waits for
    // `released` instead.
    // What this chat hears from here on, so each wait below is for this
    // turn's own frames, not ones left from the turn before.
    const heard = [];
    const off = chat.subscribe((_s, e) => heard.push(e.type === "status" ? `status:${e.status}` : e.type));
    const turnAfter = (from) => {
      const started = heard.indexOf("status:streaming", from);
      return started >= 0 && heard.indexOf("status:idle", started) >= 0;
    };

    slow = 0;
    slowSave = 400;
    let mark = heard.length;
    await hai.notify(cid, dropped, { flight: "BA2" });
    // the turn has said it is idle; its save still holds the conversation
    await until(() => turnAfter(mark), 4_000);
    posts.length = 0;
    const tail = await chat.send("right after");
    slowSave = 0;
    check(
      "a message sent as a wake turn goes idle waits for its save, and goes through",
      tail === true && heard.indexOf("released", mark) > heard.indexOf("status:idle", mark) &&
        posts.every((p) => p.status !== 409) && !chat.state.blocks.some((b) => b.kind === "error"),
    );

    // The events connection drops mid-turn. The turn runs on, holding the
    // conversation, and its `released` is lost: a message sent now must keep
    // trying until the turn lets go, not give up after one retry.
    slow = 1_500;
    mark = heard.length;
    await hai.notify(cid, dropped, { flight: "CUT" });
    await until(() => heard.indexOf("status:streaming", mark) >= 0, 4_000);
    for (const res of streams) res.destroy();
    posts.length = 0;
    const afterDrop = await chat.send("after the drop");
    slow = 0;
    off();
    check(
      "a message sent after the events connection drops mid-turn keeps trying until the turn ends",
      afterDrop === true && posts.some((p) => p.status === 409) && posts.at(-1).status === 200 &&
        asked.at(-1) === "after the drop" && !chat.state.blocks.some((b) => b.kind === "error"),
    );

    // The connection drops mid-reply and comes back while the turn still
    // runs: the reply is whole, once, not cut short or doubled.
    const plain = model.generate;
    model.generate = async (req) => {
      const last = req.messages.at(-1).content;
      if (typeof last === "string" || !last.at(-1).text.startsWith("[The user")) return plain(req);
      asked.push(last.at(-1).text);
      req.onTextDelta("Back: ");
      await new Promise((r) => setTimeout(r, 2_500)); // the client reconnects meanwhile
      req.onTextDelta("all of it.");
      return { content: [{ type: "text", text: "Back: all of it." }], stop_reason: "end_turn" };
    };
    mark = heard.length;
    await hai.notify(cid, dropped, { flight: "BACK" });
    await until(() => chat.state.blocks.some((b) => b.kind === "assistant" && b.text === "Back: "), 4_000);
    for (const res of streams) res.destroy();
    await until(() => heard.indexOf("released", mark) >= 0, 8_000);
    model.generate = plain;
    const back = chat.state.blocks.filter((b) => b.kind === "assistant" && b.text.startsWith("Back"));
    check(
      "a wake reply cut off by a dropped connection is whole once it reconnects, and shown once",
      back.length === 1 && back[0].text === "Back: all of it.",
    );

    // The server takes the conversation a moment before the wake turn can
    // stream anything. A message sent in that moment waits for the turn too,
    // however long the save before the model takes.
    await until(() => streams.size === 1, 4_000); // reconnected
    const taken = new Promise((resolve) => (onLoad = resolve));
    slowSave = 400;
    await hai.notify(cid, dropped, { flight: "EARLY" });
    await taken; // the wake turn holds the conversation now
    posts.length = 0;
    const early = await chat.send("as it wakes");
    slowSave = 0;
    check(
      "a message sent the moment a wake turn takes the conversation waits for it, and goes through",
      early === true && asked.at(-1) === "as it wakes" && !chat.state.blocks.some((b) => b.kind === "error"),
    );

    // a wake whose final save fails is reported once, by the route
    await until(() => streams.size === 1, 4_000); // reconnected
    const errorsBefore = chat.state.blocks.filter((b) => b.kind === "error").length;
    failWakeSave = true;
    await hai.notify(cid, dropped, { flight: "LOST" });
    await until(() => chat.state.blocks.filter((b) => b.kind === "error").length > errorsBefore, 3_000);
    await wait(300);
    failWakeSave = false;
    check(
      "a wake whose final save fails shows one error, not two",
      chat.state.blocks.filter((b) => b.kind === "error").length === errorsBefore + 1,
    );
    chat.close();
  } finally {
    server.close();
  }
}

// ── two processes on one store: a wake turn in one reaches tabs on the other
// Two Hai instances sharing a store stand in for two app servers behind a
// load balancer. Only the first registers the wake notice, so the turn always
// runs there; the second only streams, and relies on publish/subscribe.
async function crossInstanceChecks() {
  console.log("\nwake turns across processes");
  const http = await import("node:http");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineNotice } = await import("../packages/core/dist/index.js");
  const { createChat } = await import("../packages/client/src/index.js");
  const any = { parse: (v) => v };
  const dropped = defineNotice({ name: "dropped", version: 1, kind: "wake", payload: any }).implement({ model: (p) => `${p.flight} is cheaper.` });
  const quiet = defineNotice({ name: "quiet", version: 1, payload: any }).implement({ model: () => null });
  let slow = 0;
  const model = {
    id: "stub",
    async generate({ messages, onTextDelta }) {
      const last = messages.at(-1).content;
      const text = typeof last === "string" ? last : last.at(-1).text;
      if (!text.startsWith("[The user")) {
        onTextDelta(`You said ${text}.`);
        return { content: [{ type: "text", text: `You said ${text}.` }], stop_reason: "end_turn" };
      }
      onTextDelta("Heads up: ");
      await new Promise((r) => setTimeout(r, slow));
      onTextDelta("cheaper.");
      return { content: [{ type: "text", text: "Heads up: cheaper." }], stop_reason: "end_turn" };
    },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 3_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (cond()) return true;
    return cond();
  };
  async function stream(url, done, ms = 4_000) {
    const aborter = new AbortController();
    const got = [];
    const timer = setTimeout(() => aborter.abort(), ms);
    try {
      const res = await fetch(url, { signal: aborter.signal });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (!done(got)) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buffer = buffer.slice(i + 2);
          if (line) got.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {}
    clearTimeout(timer);
    aborter.abort();
    return got;
  }
  const released = (got) => got.some((e) => e.type === "released");
  const reply = (got) => {
    const opened = got.find((e) => e.type === "block_start" && e.block.kind === "assistant");
    return (opened?.block.text ?? "") + got.filter((e) => e.type === "text_delta" && e.id === opened?.block.id).map((e) => e.text).join("");
  };

  // ports of their own each time: fetch keeps connections alive, and a closed
  // server still answers on one it already had
  async function pair(store, [first, second]) {
    const one = createHai({ model, store, tools: [], surfaces: [], notices: [dropped], system: "x" });
    const two = createHai({ model, store, tools: [], surfaces: [], notices: [quiet], system: "x" });
    const servers = [];
    for (const [hai, port] of [[one, first], [two, second]]) {
      const handler = nodeHandler(hai, "/hai");
      const server = http.createServer(async (req, res) => {
        if (!(await handler(req, res))) res.writeHead(404).end();
      });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
      servers.push(server);
    }
    return { one, two, close: () => servers.forEach((s) => s.close()) };
  }
  const begin = async (store) => {
    const c = await store.loadConversation(undefined);
    c.messages.push({ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    c.leaseUntil = null;
    await store.saveConversation(c);
    return c.id;
  };

  // ── with publish/subscribe: tabs on the other process see the turn
  {
    const store = memoryStore();
    const { one, close } = await pair(store, [5384, 5385]);
    try {
      const id = await begin(store);
      const onOther = stream(`http://127.0.0.1:5385/hai/events?conversationId=${id}`, released);
      const onSame = stream(`http://127.0.0.1:5384/hai/events?conversationId=${id}`, released);
      await wait(150);
      slow = 400;
      await one.notify(id, dropped, { flight: "AC832" });
      await wait(200); // part way through the reply
      const late = stream(`http://127.0.0.1:5385/hai/events?conversationId=${id}`, released);
      const [other, same, joined] = await Promise.all([onOther, onSame, late]);
      check(
        "a wake turn running in one process streams to a tab on another, through the store",
        reply(same) === "Heads up: cheaper." && reply(other) === "Heads up: cheaper." && released(other),
      );
      check(
        "a tab joining on the other process mid-reply gets the reply so far, then the rest",
        reply(joined) === "Heads up: cheaper." && joined.find((e) => e.type === "block_start")?.block.text === "Heads up: ",
      );
      check("the history's whole context isn't sent across", !other.some((e) => e.type === "context"));

      // a chat on the other process waits for the turn instead of meeting a 409
      const chat = createChat({ endpoint: "http://127.0.0.1:5385/hai", registry: {} });
      await chat.send("first");
      // the turn runs where its notice's process has a stream open: another tab, there
      const watcher = stream(`http://127.0.0.1:5384/hai/events?conversationId=${chat.state.conversationId}`, released, 6_000);
      await wait(150);
      slow = 800;
      await one.notify(chat.state.conversationId, dropped, { flight: "NH7" });
      const streaming = await until(() => chat.state.status === "streaming");
      const sent = await chat.send("during");
      await watcher;
      check(
        "a message sent from the other process during the turn waits for it, and goes through",
        streaming && sent === true && !chat.state.blocks.some((b) => b.kind === "error") &&
          chat.state.blocks.some((b) => b.kind === "assistant" && b.text === "Heads up: cheaper."),
      );
      chat.close();
    } finally {
      close();
    }
  }

  // ── frames from different processes, out of order between them
  // One process's turn ends after another's has started; its late `released`
  // must not end the new one. Frames are published straight into the store,
  // as two other processes would.
  {
    const memory = memoryStore();
    const hai = createHai({ model, store: memory, tools: [], surfaces: [], notices: [quiet], system: "x" });
    const handler = nodeHandler(hai, "/hai");
    const server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(5388, "127.0.0.1", r));
    try {
      const id = await begin(memory);
      const watching = stream(`http://127.0.0.1:5388/hai/events?conversationId=${id}`, (got) => got.some((e) => e.type === "text_delta" && e.text === "done"), 3_000);
      await wait(150);
      const from = (origin, turn, event) => memory.publish(id, JSON.stringify({ origin, turn, event }));
      await from("A", "t1", { type: "status", status: "streaming" });
      await from("B", "t2", { type: "status", status: "streaming" });
      await from("A", "t1", { type: "released" }); // late, from the turn before
      await from("A", "t1", { type: "block_start", block: { kind: "assistant", id: "old", text: "" } });
      await from("B", "t2", { type: "block_start", block: { kind: "assistant", id: "new", text: "" } });
      await from("B", "t2", { type: "text_delta", id: "new", text: "done" });
      const got = await watching;
      check(
        "a turn's late `released` doesn't end the turn that started after it elsewhere",
        !got.some((e) => e.type === "released") && got.some((e) => e.type === "text_delta" && e.text === "done"),
      );
      check("…and an old turn's later frames are dropped", !got.some((e) => e.type === "block_start" && e.block.id === "old"));

      // numbered turns: an older turn's start, arriving after a newer one's, doesn't take over
      const id2 = await begin(memory);
      const numbered = stream(`http://127.0.0.1:5388/hai/events?conversationId=${id2}`, (got) => got.some((e) => e.type === "released"), 3_000);
      await wait(150);
      const at = (origin, turn, number, event) => memory.publish(id2, JSON.stringify({ origin, turn, number, event }));
      await at("B", "t4", 4, { type: "status", status: "streaming", wake: 4 });
      await at("A", "t3", 3, { type: "status", status: "streaming", wake: 3 }); // late, and older
      await at("B", "t4", 4, { type: "block_start", block: { kind: "assistant", id: "four", text: "" } });
      await at("B", "t4", 4, { type: "text_delta", id: "four", text: "newer" });
      await at("A", "t3", 3, { type: "released" });
      await at("B", "t4", 4, { type: "released" });
      const ordered = await numbered;
      check(
        "an older turn's start that arrives after a newer one's doesn't take over",
        ordered.filter((e) => e.type === "status" && e.status === "streaming").length === 1 &&
          ordered.some((e) => e.type === "text_delta" && e.text === "newer") &&
          ordered.filter((e) => e.type === "released").length === 1 && ordered.at(-1)?.type === "released",
      );
    } finally {
      server.close();
    }
  }

  // ── a stream still being set up keeps the subscription it is waiting on
  // Listening takes a while to start. Two streams wait on it; one leaves
  // before it is ready. The other must still hear later turns.
  {
    const memory = memoryStore();
    const slowStore = {
      ...memory,
      async subscribe(id, onMessage, signal) {
        await memory.subscribe(id, onMessage, signal);
        await new Promise((r) => setTimeout(r, 300));
      },
    };
    const hai = createHai({ model, store: slowStore, tools: [], surfaces: [], notices: [quiet], system: "x" });
    const handler = nodeHandler(hai, "/hai");
    const server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(5389, "127.0.0.1", r));
    try {
      const id = await begin(memory);
      const leaving = new AbortController();
      fetch(`http://127.0.0.1:5389/hai/events?conversationId=${id}`, { signal: leaving.signal }).catch(() => {});
      const staying = stream(`http://127.0.0.1:5389/hai/events?conversationId=${id}`, released, 3_000);
      await wait(100);
      leaving.abort(); // gone while listening is still starting
      await wait(400); // listening has started; the staying stream is open
      const from = (event) => memory.publish(id, JSON.stringify({ origin: "elsewhere", turn: "t9", event }));
      await from({ type: "status", status: "streaming" });
      await from({ type: "released" });
      const got = await staying;
      check("a stream that waited on listening still hears turns, though another left while it waited", released(got));
    } finally {
      server.close();
    }
  }

  // ── without them: the turn stays on its own process, as before
  {
    const memory = memoryStore();
    const { publish, subscribe, ...store } = memory;
    void publish, subscribe;
    const { one, close } = await pair(store, [5386, 5387]);
    try {
      const id = await begin(store);
      const onOther = stream(`http://127.0.0.1:5387/hai/events?conversationId=${id}`, released, 2_500);
      const onSame = stream(`http://127.0.0.1:5386/hai/events?conversationId=${id}`, released, 2_500);
      await wait(150);
      slow = 0;
      await one.notify(id, dropped, { flight: "JL1" });
      const [other, same] = await Promise.all([onOther, onSame]);
      check(
        "with a store that can't publish, only tabs on the turn's own process see it",
        reply(same) === "Heads up: cheaper." && reply(other) === "" && other.some((e) => e.type === "notice"),
      );
    } finally {
      close();
    }
  }
}

// ── a surface replayed to a stream that joins part way carries its age ──
// The browser counts a surface's freshness from when it sent the request that
// rendered it. A stream joining a wake turn sent no such request, and gets the
// surface late: the age says how late, with no clocks compared.
async function surfaceAgeChecks() {
  console.log("\nsurface age");
  const http = await import("node:http");
  const { createHai, memoryStore, nodeHandler } = await import("../packages/server/dist/index.js");
  const { defineNotice, defineSurface, defineTool } = await import("../packages/core/dist/index.js");
  const { createChat } = await import("../packages/client/src/index.js");
  const any = { parse: (v) => v };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dropped = defineNotice({ name: "dropped", version: 1, kind: "wake", payload: any }).implement({ model: () => "cheaper" });
  const fare = defineSurface({ name: "fare", version: 1, props: any }).implement({
    // a digest that takes a while: the surface is stored before it runs
    digest: () => {
      for (const end = Date.now() + 300; Date.now() < end; );
      return "a fare";
    },
    actions: {},
    queries: {},
    staleAfterMs: 60_000,
  });
  let shownHandle = null;
  let reviseToo = false; // the wake turn also revises what it shows
  const show = defineTool({
    name: "show",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    async run(_i, ctx) {
      const ret = await ctx.render(fare, { price: 302 });
      shownHandle = ret.handle;
      return ret;
    },
  });
  let reviseTwice = false; // and revises it again
  const revise = defineTool({
    name: "revise",
    description: "d",
    input: any,
    inputJsonSchema: { type: "object" },
    async run(_i, ctx) {
      const once = await ctx.update(fare, shownHandle, { price: 289 });
      return reviseTwice ? ctx.update(fare, once.handle, { price: 279 }) : once;
    },
  });
  const model = {
    id: "stub",
    async generate({ messages }) {
      const last = messages.at(-1).content;
      if (Array.isArray(last) && last.at(-1)?.text?.startsWith("[The user")) {
        return { content: [{ type: "tool_use", id: "tu_show", name: "show", input: {} }], stop_reason: "tool_use" };
      }
      if (reviseToo && Array.isArray(last) && last.some((b) => b.type === "tool_result" && b.tool_use_id === "tu_show")) {
        return { content: [{ type: "tool_use", id: "tu_revise", name: "revise", input: {} }], stop_reason: "tool_use" };
      }
      if (Array.isArray(last) && last.some((b) => b.type === "tool_result")) await wait(1_000); // the turn runs on after showing it
      return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    },
  };
  const store = memoryStore();
  const hai = createHai({ model, store, tools: [show, revise], surfaces: [fare], notices: [dropped], system: "x", maxWakes: { count: 10, perMs: 60_000 } });
  const handler = nodeHandler(hai, "/hai");
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(5390, "127.0.0.1", r));
  async function stream(url, done, ms = 4_000) {
    const aborter = new AbortController();
    const got = [];
    const timer = setTimeout(() => aborter.abort(), ms);
    let headers = null;
    try {
      const res = await fetch(url, { signal: aborter.signal });
      headers = res.headers;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (!done(got)) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buffer = buffer.slice(i + 2);
          if (line) got.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {}
    clearTimeout(timer);
    aborter.abort();
    return { got, headers };
  }
  const released = (got) => got.some((e) => e.type === "released");

  try {
    const c = await store.loadConversation(undefined);
    c.messages.push({ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    c.leaseUntil = null;
    await store.saveConversation(c);
    const first = stream(`http://127.0.0.1:5390/hai/events?conversationId=${c.id}`, released);
    await wait(150);
    await hai.notify(c.id, dropped, {});
    await wait(500); // the surface is shown, and the turn runs on
    const late = await stream(`http://127.0.0.1:5390/hai/events?conversationId=${c.id}`, released);
    const watched = await first;
    const live = watched.got.find((e) => e.type === "ui_open");
    const replayed = late.got.find((e) => e.type === "ui_open");
    check(
      `a surface streamed as it is shown is aged from when it was stored, its digest's time included (${live?.ageMs} ms)`,
      typeof live?.ageMs === "number" && live.ageMs >= 290 && live.ageMs < 2_000,
    );
    check(
      `a surface replayed to a stream that joins later carries its age, the wait included (${replayed?.ageMs} ms)`,
      typeof replayed?.ageMs === "number" && replayed.ageMs >= live.ageMs + 150 && replayed.ageMs < 4_000,
    );
    check(
      "the events stream asks proxies not to buffer or transform it",
      watched.headers?.get("x-accel-buffering") === "no" && /no-transform/.test(watched.headers?.get("cache-control") ?? ""),
    );

    // a wake turn that shows a surface, then revises it: a stream joining
    // later sees it once, as it is now
    reviseToo = true;
    const c2 = await store.loadConversation(undefined);
    c2.messages.push({ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    c2.leaseUntil = null;
    await store.saveConversation(c2);
    const watching = stream(`http://127.0.0.1:5390/hai/events?conversationId=${c2.id}`, released);
    await wait(150);
    await hai.notify(c2.id, dropped, {});
    await wait(700); // shown, revised, and the turn runs on
    const joined = await stream(`http://127.0.0.1:5390/hai/events?conversationId=${c2.id}`, released);
    const liveOpens = (await watching).got.filter((e) => e.type === "ui_open");
    reviseToo = false;
    const opens = joined.got.filter((e) => e.type === "ui_open");
    const props = joined.got.filter((e) => e.type === "ui_props");
    check(
      "a stream joining after a wake turn revised its surface sees it once, as revised",
      opens.length === 1 && props.length === 1 && props[0].props.price === 289 && props[0].handle === opens[0].handle,
    );
    check(
      "…still marked as replacing the original, under the original's tool row, as a browser that saw it keeps it",
      opens[0]?.replaces === liveOpens[0]?.handle && opens[0]?.toolId === liveOpens[0]?.toolId,
    );

    // revised twice: the replay names the handle before, and the original too
    reviseToo = true;
    reviseTwice = true;
    const c3 = await store.loadConversation(undefined);
    c3.messages.push({ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] });
    c3.leaseUntil = null;
    await store.saveConversation(c3);
    const watching3 = stream(`http://127.0.0.1:5390/hai/events?conversationId=${c3.id}`, released);
    await wait(150);
    await hai.notify(c3.id, dropped, {});
    await wait(700);
    const joined3 = await stream(`http://127.0.0.1:5390/hai/events?conversationId=${c3.id}`, released);
    const live3 = (await watching3).got.filter((e) => e.type === "ui_open");
    reviseToo = false;
    reviseTwice = false;
    const [a, b, cc] = live3.map((e) => e.handle);
    const replay3 = joined3.got.filter((e) => e.type === "ui_open");
    check(
      `a surface revised twice is replayed once, naming every handle it had (${a} → ${b} → ${cc})`,
      replay3.length === 1 && replay3[0].handle === cc && replay3[0].replaces === b &&
        JSON.stringify(replay3[0].alsoReplaces) === JSON.stringify([a]),
    );
  } finally {
    server.close();
  }

  // ── the client counts a replayed surface's freshness from its age
  // A server that replays a wake turn's surface, 700 ms old, good for 1 s.
  const fake = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const frame = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (req.url.includes("/events")) {
      frame({ type: "status", status: "streaming", wake: 1 });
      frame({ type: "ui_open", handle: "ui_01", toolId: "b1", component: "fare", version: 1, mode: "display", staleAfterMs: 1_000, ageMs: 700 });
      frame({ type: "ui_props", handle: "ui_01", props: {} });
      return; // and stays open, as a turn still running does
    }
    req.resume();
    req.on("end", () => {
      frame({ type: "hello", conversationId: "conv_age", model: "m", events: true });
      res.end(`data: ${JSON.stringify({ type: "status", status: "idle" })}\n\n`);
    });
  });
  await new Promise((r) => fake.listen(5391, "127.0.0.1", r));
  const chat = createChat({ endpoint: "http://127.0.0.1:5391/hai", registry: {} });
  try {
    await chat.send("hi");
    const sent = Date.now();
    for (let i = 0; i < 200 && !chat.state.surfaces.has("ui_01"); i++) await wait(10);
    const arrived = Date.now();
    const deadline = chat.state.expiresAt;
    check(
      "a replayed surface's deadline counts from when it was stored, by its age, not from when it arrived",
      typeof deadline === "number" && deadline <= arrived - 700 + 1_000 && deadline >= sent - 700 + 1_000 - 200,
    );
  } finally {
    chat.close();
    fake.close();
  }
}

// ── the client swaps a revision into the component on screen ───────────
async function revisionClientChecks() {
  console.log("\nsurface revisions in the client");
  const http = await import("node:http");
  const { createChat } = await import("../packages/client/src/index.js");
  // Each chat request answers with the next stream in line.
  const streams = [];
  const posts = [];
  let events = null; // the open events stream, written to when a test says
  const server = http.createServer((req, res) => {
    if (req.url.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      events = res;
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      posts.push({ path: req.url, body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of streams.shift() ?? []) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => server.listen(5392, "127.0.0.1", r));
  const hello = { type: "hello", conversationId: "conv_rev", model: "m" };
  const idle = { type: "status", status: "idle" };
  const open = (handle, component, staleAfterMs, extra = {}) => ({
    type: "ui_open", handle, toolId: "b1", component, version: 1, mode: "display", staleAfterMs, ...extra,
  });
  const el = () => ({ replaceChildren() {}, dataset: {}, textContent: "", className: "" });

  const mounts = [];
  const updates = [];
  let sendFrom = null;
  let mountedCtx = null;
  const registry = {
    // keeps what it holds through a revision
    card: {
      mount(_el, props, ctx) {
        mounts.push({ component: "card", props });
        sendFrom = ctx.send;
        mountedCtx = ctx;
        return { update: (next) => updates.push(next), unmount() {} };
      },
    },
    // has no update: mounted again
    plain: {
      mount(_el, props) {
        mounts.push({ component: "plain", props });
        return { unmount() {} };
      },
    },
  };
  const chat = createChat({ endpoint: "http://127.0.0.1:5392/hai", registry });
  try {
    streams.push([hello, open("ui_01", "card", 10_000), { type: "ui_props", handle: "ui_01", props: { price: 343 } }, idle]);
    await chat.send("show");
    const record = chat.state.surfaces.get("ui_01");
    chat.mount("ui_01", el());
    const firstDeadline = chat.state.expiresAt;
    streams.push([hello, open("ui_02", "card", 60_000, { replaces: "ui_01" }), { type: "ui_props", handle: "ui_02", props: { price: 389 } }, idle]);
    const sentAt = Date.now();
    await chat.send("reprice");
    check(
      "a revision takes over the surface's record, and the transcript's block, under its new handle",
      !chat.state.surfaces.has("ui_01") && chat.state.surfaces.get("ui_02") === record &&
        chat.state.blocks.filter((b) => b.kind === "ui").map((b) => b.handle).join() === "ui_02",
    );
    check(
      "a component with update gets the new props, without being mounted again",
      mounts.length === 1 && updates.length === 1 && updates[0].price === 389 && record.props.price === 389,
    );
    posts.length = 0;
    await sendFrom("note", "x");
    check("a click after the revision names the new handle", posts[0]?.body.handle === "ui_02");
    check("…and the component's ctx.handle has moved on with it", mountedCtx?.handle === "ui_02");
    check(
      "the deadline is the revision's: the surface it replaced stops counting",
      chat.state.expiresAt > firstDeadline && chat.state.expiresAt >= sentAt + 60_000 - 50,
    );

    // without update, the component is mounted again in place, with the new props
    streams.push([hello, open("ui_03", "plain", undefined), { type: "ui_props", handle: "ui_03", props: { v: 1 } }, idle]);
    await chat.send("plain");
    chat.mount("ui_03", el());
    streams.push([hello, open("ui_04", "plain", undefined, { replaces: "ui_03" }), { type: "ui_props", handle: "ui_04", props: { v: 2 } }, idle]);
    await chat.send("revise plain");
    const plain = mounts.filter((m) => m.component === "plain");
    check("a component without update is mounted again, with the revision's props", plain.length === 2 && plain[1].props.v === 2);
  } finally {
    chat.close();
  }

  // notices beside a revised surface keep the order they arrived in
  const telling = createChat({ endpoint: "http://127.0.0.1:5392/hai", registry: {} });
  const helloE = { ...hello, conversationId: "conv_rev2", events: true };
  const notice = (seq, handle) => ({ type: "notice", seq, name: "n", version: 1, payload: {}, handle });
  const frame = (e) => events.write(`data: ${JSON.stringify(e)}\n\n`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const order = () =>
    telling.state.blocks.filter((b) => b.kind === "ui" || b.kind === "notice").map((b) => (b.kind === "ui" ? `ui:${b.handle}` : `n${b.seq}`)).join(" ");
  try {
    events = null;
    streams.push([helloE, open("ui_10", "card", undefined), { type: "ui_props", handle: "ui_10", props: {} }, idle]);
    await telling.send("show");
    for (let i = 0; i < 100 && !events; i++) await wait(10);
    frame(notice(1, "ui_10"));
    frame(notice(2, "ui_11")); // for the revision, before it has arrived
    for (let i = 0; i < 100 && telling.state.notices.length < 2; i++) await wait(10);
    streams.push([helloE, open("ui_11", "card", undefined, { replaces: "ui_10" }), { type: "ui_props", handle: "ui_11", props: {} }, idle]);
    await telling.send("revise");
    check(`a notice that arrived before its revision goes after those already beside the surface (${order()})`, order() === "ui:ui_11 n1 n2");
    frame(notice(3, "ui_11"));
    for (let i = 0; i < 100 && telling.state.notices.length < 3; i++) await wait(10);
    check(`…and one that arrives after it goes after them all (${order()})`, order() === "ui:ui_11 n1 n2 n3");

    // a replayed revision several steps on, to a browser that saw only the first
    streams.push([helloE, open("ui_20", "card", undefined), { type: "ui_props", handle: "ui_20", props: {} }, idle]);
    await telling.send("show again");
    streams.push([helloE, open("ui_30", "card", undefined), { type: "ui_props", handle: "ui_30", props: {} }, idle]);
    await telling.send("and another");
    frame(notice(4, "ui_21")); // names the revision this browser will miss, before it hears of it
    frame(notice(5, "ui_20")); // sent after it, and shown beside the surface
    for (let i = 0; i < 100 && telling.state.notices.length < 5; i++) await wait(10);
    streams.push([helloE, open("ui_22", "card", undefined, { replaces: "ui_21", alsoReplaces: ["ui_20"] }), { type: "ui_props", handle: "ui_22", props: {} }, idle]);
    await telling.send("replayed");
    const handles = telling.state.blocks.filter((b) => b.kind === "ui").map((b) => b.handle);
    check(
      `a revision replayed past one this browser missed swaps in from the handle it did see (${handles.join(" ")})`,
      handles.join(" ") === "ui_11 ui_22 ui_30" && !telling.state.surfaces.has("ui_20"),
    );
    check(
      `a notice naming the missed handle, which went to the end, moves beside the surface, in the order sent (${order()})`,
      order() === "ui:ui_11 n1 n2 n3 ui:ui_22 n4 n5 ui:ui_30",
    );
    // caught up after the replay: naming the missed handle, then the one it saw
    frame(notice(6, "ui_21"));
    frame(notice(7, "ui_20"));
    frame(notice(8));
    for (let i = 0; i < 100 && telling.state.notices.length < 8; i++) await wait(10);
    check(
      `notices naming any earlier handle of the surface go beside it as it is now, in order (${order()})`,
      order() === "ui:ui_11 n1 n2 n3 ui:ui_22 n4 n5 n6 n7 ui:ui_30 n8",
    );
  } finally {
    telling.close();
    events?.destroy();
    server.close();
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
      Object.assign(this, { tagName: tag, children: [], dataset: {}, className: "", own: 20 });
      Object.assign(this, { nodeType: 1, parentNode: null, moves: 0, text: "", attributes: {} });
      this.style = { setProperty: (name, value) => (this.style[name] = value) };
    }
    // as in the DOM: its own text and its children's, and setting it replaces them
    get textContent() {
      return this.text + this.children.map((c) => c.textContent).join("");
    }
    set textContent(value) {
      for (const child of [...this.children]) child.remove();
      this.text = String(value);
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
      // every child comes out first, so one put straight back has moved too;
      // text set through textContent is a child in the DOM, so it goes as well
      for (const child of [...this.children]) child.remove();
      this.text = "";
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
    // icons and ARIA
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
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

    // ── what a tool row says of its call ──────────────────────────────
    // The server leaves an elicit tool's row `awaiting` for good. The row works
    // out from its question's surface whether the question has closed.
    const rows = new Root();
    const asking = { state: { blocks: [], surfaces: new Map(), expired: null }, mount() {} };
    const call = (id, status, extra) => {
      const block = { kind: "tool", id, name: "ask", input: {}, status, ms: 12, result: "…", ...extra };
      asking.state.blocks.push(block);
      return block;
    };
    const shown = (handle, toolId, mode) => {
      asking.state.surfaces.set(handle, { component: "x", mode, state: "live", props: {} });
      asking.state.blocks.push({ kind: "ui", id: `ui:${handle}`, handle, toolId });
    };
    const freeze = (handle, selection) => Object.assign(asking.state.surfaces.get(handle), { state: "frozen", selection });
    // the row's status class and the words it shows
    const says = (block) => {
      renderTranscript(rows, asking);
      const row = rows.children[asking.state.blocks.indexOf(block)];
      return `${row.className.match(/hai-status-\S+/)?.[0]} ${row.children[0].children[3].textContent}`;
    };

    const finished = call("t-ok", "ok");
    const failed = call("t-failed", "error", { ms: 40 });
    check("a finished call shows how long it took", says(finished) === "hai-status-ok 12 ms");
    check("a failed call says so, and how long it took", says(failed) === "hai-status-error failed · 40 ms");

    const answered = call("t-answered", "awaiting");
    shown("q-answered", "t-answered", "elicit");
    check("a live question is awaiting the user", says(answered) === "hai-status-awaiting awaiting you");
    freeze("q-answered", "he");
    check("an answered question is resolved", says(answered) === "hai-status-resolved resolved");

    const typedOver = call("t-typed", "awaiting");
    shown("q-typed", "t-typed", "elicit");
    says(typedOver);
    freeze("q-typed");
    check("a question the user typed over is resolved", says(typedOver) === "hai-status-resolved resolved");

    const both = call("t-both", "awaiting");
    shown("d-both", "t-both", "display");
    shown("q-both", "t-both", "elicit");
    check("a display surface shown before the question doesn't stand in for it", says(both) === "hai-status-awaiting awaiting you");
    freeze("q-both", "he");
    check("…and answering the question resolves the row, though the display surface stays live", says(both) === "hai-status-resolved resolved");

    const late = call("t-late", "awaiting");
    check("a row whose question hasn't been seen yet is awaiting", says(late) === "hai-status-awaiting awaiting you");
    shown("q-late", "t-late", "elicit");
    says(late);
    freeze("q-late", "he");
    check("a question that arrives after a lookup found nothing is still found", says(late) === "hai-status-resolved resolved");

    const revised = call("t-revised", "awaiting");
    shown("q-v1", "t-revised", "elicit");
    says(revised);
    // revised in place, as the client does: the record and the block move to the new handle
    asking.state.surfaces.set("q-v2", asking.state.surfaces.get("q-v1"));
    asking.state.surfaces.delete("q-v1");
    asking.state.blocks.find((b) => b.kind === "ui" && b.handle === "q-v1").handle = "q-v2";
    check("a question revised after its row found it is still awaiting", says(revised) === "hai-status-awaiting awaiting you");
    freeze("q-v2", "he");
    check("…and its row resolves when the revision is answered", says(revised) === "hai-status-resolved resolved");

    const unanswered = call("t-open", "awaiting");
    shown("q-open", "t-open", "elicit");
    says(unanswered);
    asking.state.expired = "out of date";
    check("an unanswered question is out of date once the conversation is", says(unanswered) === "hai-status-expired out of date");
    check("an answered one stays resolved", says(answered) === "hai-status-resolved resolved");
    closeTranscript(rows);

    // ── a running tool's progress ─────────────────────────────────────
    // Progress changes the row in place. A row rebuilt for every frame would
    // take the focus of a keyboard user on it, up to ten times a second.
    const running = new Root();
    const working = { state: { blocks: [], surfaces: new Map(), expired: null }, mount() {} };
    const runningTool = { kind: "tool", id: "t-run", name: "search", input: {}, status: "running" };
    working.state.blocks.push(runningTool);
    const runRow = () => {
      renderTranscript(running, working);
      const el = running.children[0];
      const summary = el.children[0];
      return { el, text: summary.children[3].textContent, bar: summary.children.find((c) => c.className === "hai-tbar") };
    };
    const first = runRow();
    check("a running tool with no progress says it is running", first.text === "running…" && first.bar?.hidden === true);
    check("its progress bar has an accessible name", first.bar?.attributes["aria-label"] === "search progress");

    runningTool.progress = { message: "Checking fare sources", done: 1, total: 4 };
    const counting = runRow();
    check("progress shows the message and the count", counting.text === "Checking fare sources · 1/4");
    check(
      "…in the same row, which has not moved",
      counting.el === first.el && first.el.moves === 0 && running.children.length === 1,
    );
    check(
      "…with the bar filled, and its value said in words",
      counting.bar?.hidden === false &&
        counting.bar.style["--hai-progress"] === "25%" &&
        counting.bar.attributes["aria-valuetext"] === "Checking fare sources · 1 of 4",
    );

    runningTool.progress = { ...runningTool.progress, message: "" };
    check("a message cleared to nothing leaves the count", runRow().text === "1/4");
    runningTool.progress = { message: "" };
    const cleared = runRow();
    check("progress with nothing to show says it is running again", cleared.text === "running…" && cleared.bar.hidden);

    Object.assign(runningTool, { status: "ok", ms: 12 });
    const done = runRow();
    check("a finished call shows how long it took, with no bar", done.text === "12 ms" && !done.bar);
    closeTranscript(running);

    // ── a notice: labelled, announced, and drawn by the app's component ─
    const noticed = new Root();
    const mounted = [];
    const telling = {
      state: { blocks: [], surfaces: new Map(), expired: null },
      mount() {},
      mountNotice: (seq, el) => mounted.push({ seq, el }),
    };
    telling.state.blocks.push({ kind: "notice", id: "n:3", seq: 3, name: "hold_confirmed", version: 1, payload: {} });
    renderTranscript(noticed, telling);
    await settled();
    const card = noticed.children[0];
    check(
      "a notice is a status region labelled with its name",
      card?.className === "hai-notice" && card.attributes.role === "status" &&
        card.children[0].textContent === "notice · hold_confirmed",
    );
    check(
      "…and its component is mounted into its body, once",
      mounted.length === 1 && mounted[0].seq === 3 && mounted[0].el === card.children[1],
    );
    renderTranscript(noticed, telling);
    await settled();
    check("rendering again leaves a notice mounted as it was", mounted.length === 1 && noticed.children[0] === card);
    closeTranscript(noticed);

    // ── a revision keeps the surface's element, under its new handle ────
    const revising = new Root();
    let surfaceMounts = 0;
    const record = { component: "fare", props: { price: 343 }, mode: "display", state: "live" };
    const showing = {
      state: { blocks: [{ kind: "ui", id: "ui:ui_01", handle: "ui_01", toolId: "t" }], surfaces: new Map([["ui_01", record]]), expired: null },
      mount: () => void surfaceMounts++,
    };
    renderTranscript(revising, showing);
    await settled();
    const element = revising.children[0];
    // what the client does with a revision: the record and block move to the new handle
    showing.state.surfaces.delete("ui_01");
    showing.state.surfaces.set("ui_02", record);
    showing.state.blocks[0].handle = "ui_02";
    renderTranscript(revising, showing);
    await settled();
    check(
      "a revised surface keeps its element and its mount, its data-handle moved on",
      revising.children[0] === element && element.moves === 0 && surfaceMounts === 1 && element.dataset.handle === "ui_02",
    );
    closeTranscript(revising);
  } finally {
    if (!hadDocument) delete globalThis.document;
    if (!hadObserver) delete globalThis.ResizeObserver;
  }
}

// ── the scope rides on the system prompt the model actually receives ────
async function scopeChecks() {
  console.log("\nscope");
  const { createHai, DEFAULT_SCOPE } = await import("../packages/server/dist/index.js");

  const sent = async (scope) => {
    let system;
    const model = {
      id: "stub",
      async generate(request) {
        system = request.system;
        return { content: [], stop_reason: "end_turn" };
      },
    };
    const store = memoryStore();
    const hai = createHai({ model, store, tools: [], surfaces: [], system: "app", scope });
    const conversation = await store.loadConversation(undefined);
    await hai.send(conversation, "hi", () => {});
    return system;
  };

  check("by default the scope follows the app's system prompt", (await sent(undefined)) === `app\n\n${DEFAULT_SCOPE}`);
  check("a scope string replaces the default", (await sent("only flights")) === "app\n\nonly flights");
  check("scope: false leaves the app's system prompt alone", (await sent(false)) === "app");
  check("an empty scope adds nothing, not a trailing blank line", (await sent("")) === "app");
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
  await scopeChecks();
  await windowChecks();
  await clientChecks();
  await noticeStreamChecks();
  await wakeStreamChecks();
  await crossInstanceChecks();
  await surfaceAgeChecks();
  await revisionClientChecks();
  await updateStreamChecks();
  await transcriptChecks();

  // Said plainly because a suite that looks exhaustive is worse than one that
  // admits its edges: nothing here can prove lease acquisition is atomic. This
  // process cannot interleave two acquisitions, so a read-then-write adapter
  // passes every check above and still races. Review that per adapter.
  console.log("\n  not covered: atomicity of lease acquisition or of fenced writes (single process)");

  console.log(failures ? `\n${failures} check(s) failed\n` : "\nstore: all checks passed\n");
  process.exit(failures ? 1 : 0);
}
