/**
 * Minimal surfaces for the negative type tests.
 *
 * Note the schemas: a bare object with a `parse` method. Core accepts schemas
 * structurally, so its own tests can prove the guarantees without depending on
 * zod — or on any example app.
 */

import { defineSurface, inform, query, resolve, type Schema } from "../../src/index.js";

const str: Schema<string> = { parse: (v) => v as string };
const any: Schema<Record<string, unknown>> = { parse: (v) => v as Record<string, unknown> };

export interface Row {
  id: string;
  label: string;
}

const rows: Schema<{ rows: Row[] }> = { parse: (v) => v as { rows: Row[] } };

/** Has a resolve action — legal to render as `elicit`. */
export const picker = defineSurface({
  name: "fixture_picker",
  version: 1,
  props: rows,
  actions: { choose: resolve(str) },
  queries: { filter: query(any) },
});

/** Inform only — rendering this as `elicit` must not compile. */
export const card = defineSurface({
  name: "fixture_card",
  version: 1,
  props: rows,
  actions: { note: inform(str) },
});

export const cardImpl = card.implement({
  digest: () => "card",
  actions: { note: () => "noted" },
  queries: {},
});

export const pickerImpl = picker.implement({
  digest: () => "picker",
  actions: { choose: (id) => `chose ${id}` },
  queries: { filter: (_args, { props, cap }) => cap(props.rows, (r) => r.label) },
});
