/**
 * Negative type tests for @haikit/core.
 *
 * Every block below MUST fail to compile. `npm run typetest` compiles this file
 * twice — once as-is (must be clean, so no @ts-expect-error is stale) and once
 * with the directives stripped (every marked line must error).
 *
 * These assert CORE's guarantees, so they live with core. An example app is the
 * wrong owner: delete the example and the regression test goes with it.
 */

import { defineSignal, defineSurface, inform, type Notify, type Schema, type SendSignal, type ToolCtx, type Update } from "../../src/index.js";
import { card, cardImpl, droppedNotice, heldNotice, heldNoticeImpl, picker, pickerImpl, type Row } from "./fixture.js";

declare const ctx: ToolCtx;
declare const notify: Notify;
declare const update: Update;
declare const signal: SendSignal;
const online = defineSignal({ name: "online", version: 1, payload: { parse: (v) => v as { count: number } } });
declare const props: { rows: Row[] };

const str: Schema<string> = { parse: (v) => v as string };

// ── GUARANTEE 1: a surface cannot exist without a digest ───────────────
// @ts-expect-error  Property 'digest' is missing
picker.implement({
  actions: { choose: () => "x" },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
  staleAfterMs: "never",
});

// ── GUARANTEE 1, for notices: a notice says what the model hears ────────
// @ts-expect-error  Property 'model' is missing
heldNotice.implement({});

// @ts-expect-error  model() answers with text or null, not a number
heldNotice.implement({ model: () => 42 });

// @ts-expect-error  a wake notice starts a turn: the model must hear something
droppedNotice.implement({ model: () => null });

// ── GUARANTEE 2: a query must return Capped, i.e. must call cap() ──────
picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: {
    // @ts-expect-error  a raw array is not assignable to Capped
    filter: (_args, { props: p }) => p.rows,
  },
  staleAfterMs: "never",
});

picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: {
    // @ts-expect-error  a hand-built object literal cannot satisfy Capped
    filter: () => ({ text: "3 of 47", shown: 3, total: 47 }),
  },
  staleAfterMs: "never",
});

// ── GUARANTEE 3: elicit requires a declared resolve action ─────────────
// @ts-expect-error  fixture_card declares only `inform` — elicit would deadlock
await ctx.render(cardImpl, props, { mode: "elicit" });

// ── GUARANTEE 4: undeclared actions do not exist ───────────────────────
picker.implement({
  digest: () => "x",
  // @ts-expect-error  'deleteEverything' is not declared in the contract
  actions: { choose: () => "x", deleteEverything: () => "boom" },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
  staleAfterMs: "never",
});

// ── a freshness window is milliseconds or "never" ──────────────────────
picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
  // @ts-expect-error  a window is milliseconds or "never" — not a duration string
  staleAfterMs: "15m",
});

// ── an action handler answers with a label, now or later ──────────────
picker.implement({
  digest: () => "x",
  // @ts-expect-error  a handler resolving to a number is not a label
  actions: { choose: async () => 42 },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
});

// ── props are typed from the contract ──────────────────────────────────
// @ts-expect-error  'rows' is missing
await ctx.render(pickerImpl, { wrong: true }, { mode: "elicit" });

// ── a revision's props are too, in a turn or out of one ────────────────
// @ts-expect-error  'rows' is missing
await ctx.update(pickerImpl, "ui_01", { wrong: true });

// @ts-expect-error  'rows' is missing
await update("conv_1", pickerImpl, "ui_01", { wrong: true });

// @ts-expect-error  wake is a boolean
await update("conv_1", cardImpl, "ui_01", props, { wake: "yes" });

// ── a signal's payload is typed from its contract ──────────────────────
// @ts-expect-error  'count' is a number
signal(online, { count: "many" });

// @ts-expect-error  'count' is missing
signal(online, {});

// ── a notice's payload is typed from its contract ──────────────────────
// @ts-expect-error  'flight' is missing
await notify("conv_1", heldNoticeImpl, { fare: 343 });

// @ts-expect-error  'flight' is a string
await notify("conv_1", heldNoticeImpl, { flight: 832 });

// ── correct calls, for contrast — these must NOT error ─────────────────
// a notice the model hears nothing of says so
heldNotice.implement({ model: () => null });
// a wake notice says what the turn it starts is about, and sends like any other
const droppedImpl = droppedNotice.implement({ model: (p) => `${p.flight} dropped.` });
await notify("conv_1", droppedImpl, { flight: "AC832" });
await notify("conv_1", heldNoticeImpl, { flight: "AC832" });
const { seq }: { seq: number } = await notify("conv_1", heldNoticeImpl, { flight: "AC832" }, { handle: "ui_01" });
void seq;
const { handle: revised }: { handle: string } = await update("conv_1", cardImpl, "ui_01", props, { model: "Fares moved.", wake: true, timeoutMs: 1_000 });
await ctx.update(cardImpl, revised, props);
signal(online, { count: 12 });
// no window declared: it defaults to "never", so code written before
// freshness windows existed still compiles
picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
});
// an async handler, which can write before it answers
picker.implement({
  digest: () => "x",
  actions: {
    choose: async (id, { handle, conversationId }) => {
      const key: string = `${conversationId}/${handle}`;
      await Promise.resolve(key);
      return `chose ${id}`;
    },
  },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
});
await ctx.render(pickerImpl, props, { mode: "elicit" });
await ctx.render(cardImpl, props);
await ctx.render(cardImpl, props, { mode: "display" });

void defineSurface;
void inform;
void card;
void str;
