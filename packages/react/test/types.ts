/**
 * Compile-time checks: a React surface component is typed from the surface
 * contract. Compiled by `npm run typecheck`; every @ts-expect-error must be
 * load-bearing, or tsc reports it as unused.
 */

import { defineNotice, defineSurface, inform, resolve, type Schema } from "@haikit/core";
import { reactNotice, reactSurface, type NoticeProps, type SurfaceProps } from "../src/index.js";

const str: Schema<string> = { parse: (v) => v as string };
const rows: Schema<{ rows: string[] }> = { parse: (v) => v as { rows: string[] } };
const picker = defineSurface({ name: "picker", version: 1, props: rows, actions: { choose: resolve(str), note: inform(rows) } });

function Picker({ props, send }: SurfaceProps<typeof picker>) {
  void props.rows.map((r) => r.toUpperCase());
  void send("choose", "a");
  void send("note", { rows: [] });
  // @ts-expect-error  an action the contract does not declare
  void send("delete_everything", "a");
  // @ts-expect-error  choose takes a string
  void send("choose", 42);
  // @ts-expect-error  props are typed from the contract
  void props.nope;
  return null;
}

export const registry = { picker: reactSurface(Picker) };

const held = defineNotice({ name: "held", version: 1, payload: { parse: (v) => v as { flight: string } } });

function Held({ payload, seq }: NoticeProps<typeof held>) {
  void payload.flight.toUpperCase();
  void seq.toFixed();
  // @ts-expect-error  the payload is typed from the contract
  void payload.fare;
  return null;
}

// @ts-expect-error  a notice has nothing to send
function Sends({ send }: NoticeProps<typeof held>) {
  void send;
  return null;
}
void Sends;

export const notices = { held: reactNotice(Held) };

// a wake notice renders the same way, typed from its contract too
const dropped = defineNotice({ name: "dropped", version: 1, kind: "wake", payload: { parse: (v) => v as { was: number } } });

function Dropped({ payload }: NoticeProps<typeof dropped>) {
  void payload.was.toFixed();
  // @ts-expect-error  the payload is typed from the contract
  void payload.now;
  return null;
}

export const wakeNotices = { dropped: reactNotice(Dropped) };
