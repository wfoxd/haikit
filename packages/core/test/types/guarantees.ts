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

import { defineSurface, inform, type Schema, type ToolCtx } from "../../src/index.js";
import { card, cardImpl, picker, pickerImpl, type Row } from "./fixture.js";

declare const ctx: ToolCtx;
declare const props: { rows: Row[] };

const str: Schema<string> = { parse: (v) => v as string };

// ── GUARANTEE 1: a surface cannot exist without a digest ───────────────
// @ts-expect-error  Property 'digest' is missing
picker.implement({
  actions: { choose: () => "x" },
  queries: { filter: (_a, { props: p, cap }) => cap(p.rows, String) },
});

// ── GUARANTEE 2: a query must return Capped, i.e. must call cap() ──────
picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: {
    // @ts-expect-error  a raw array is not assignable to Capped
    filter: (_args, { props: p }) => p.rows,
  },
});

picker.implement({
  digest: () => "x",
  actions: { choose: () => "x" },
  queries: {
    // @ts-expect-error  a hand-built object literal cannot satisfy Capped
    filter: () => ({ text: "3 of 47", shown: 3, total: 47 }),
  },
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
});

// ── props are typed from the contract ──────────────────────────────────
// @ts-expect-error  'rows' is missing
await ctx.render(pickerImpl, { wrong: true }, { mode: "elicit" });

// ── correct calls, for contrast — these must NOT error ─────────────────
await ctx.render(pickerImpl, props, { mode: "elicit" });
await ctx.render(cardImpl, props);
await ctx.render(cardImpl, props, { mode: "display" });

void defineSurface;
void inform;
void card;
void str;
