/**
 * Code excerpts, read from source when the server starts.
 *
 * Part 2 of the course quotes real code: this app's own files, and the haikit
 * packages installed in node_modules. Reading them at startup instead of
 * pasting them into the lessons means a lesson can't show code that no longer
 * exists. If a quoted region moves or disappears, the server refuses to start
 * and says which selector to fix, and `npm test` fails with it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** How to find the lines to quote. */
export type Selector =
  /** Between `#region name` and the next `#endregion`, in any comment syntax. */
  | { region: string }
  /**
   * From the first line containing `start`, through the first later line
   * containing `until`, or up to the line before one containing `before`.
   * With neither, through the next line that is exactly `}`.
   */
  | { start: string; until?: string; before?: string };

/** A file to quote, and the name a lesson shows for it. */
export interface Source {
  path: string;
  label: string;
}

/** This app's root: the folder holding its package.json. */
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A file in this app, labelled relative to the app. */
export const appFile = (rel: string): Source => ({ path: path.join(APP, rel), label: rel });

/**
 * A file in an installed package, found the way node finds the package: the
 * code this server is actually running, not a copy of it.
 */
export function packageFile(pkg: string, rel: string): Source {
  const manifest = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  return { path: path.join(path.dirname(manifest), rel), label: `${pkg}/${rel}` };
}

/** What the version line in the header shows. */
export function packageVersion(pkg: string): string {
  const manifest = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
}

export function excerpt(file: Source, pick: Selector): { code: string; source: string } {
  let text: string;
  try {
    text = fs.readFileSync(file.path, "utf8");
  } catch {
    throw new Error(`excerpt: cannot read ${file.label} (${file.path})`);
  }
  const lines = text.split("\n");
  const fail = (what: string): never => {
    throw new Error(
      `excerpt: ${what} not found in ${file.label}. ` +
        `The course quotes it; update the selector in src/server/course/.`,
    );
  };

  let first: number;
  let last: number;
  if ("region" in pick) {
    const opener = new RegExp(`#region ${pick.region}(?![\\w-])`);
    const start = lines.findIndex((l) => opener.test(l));
    if (start < 0) fail(`#region ${pick.region}`);
    const end = lines.findIndex((l, i) => i > start && l.includes("#endregion"));
    if (end < 0) fail(`#endregion for ${pick.region}`);
    first = start + 1;
    last = end - 1;
  } else {
    first = lines.findIndex((l) => l.includes(pick.start));
    if (first < 0) fail(JSON.stringify(pick.start));
    const after = (match: (l: string) => boolean) => lines.findIndex((l, i) => i > first && match(l));
    if (pick.until) {
      last = after((l) => l.includes(pick.until!));
      if (last < 0) fail(JSON.stringify(pick.until));
    } else if (pick.before) {
      last = after((l) => l.includes(pick.before!)) - 1;
      if (last < first) fail(JSON.stringify(pick.before));
    } else {
      last = after((l) => l === "}");
      if (last < 0) fail(`the closing } after ${JSON.stringify(pick.start)}`);
    }
  }

  // markers of other regions nested inside this one are not code
  let kept = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .slice(first, last + 1)
    .filter(({ line }) => !/#(end)?region\b/.test(line));
  while (kept.length && !kept[0].line.trim()) kept.shift();
  while (kept.length && !kept.at(-1)!.line.trim()) kept.pop();
  if (!kept.length) fail("any code in the selected lines");

  const indent = Math.min(
    ...kept.filter(({ line }) => line.trim()).map(({ line }) => line.match(/^ */)![0].length),
  );
  return {
    code: kept.map(({ line }) => line.slice(indent)).join("\n"),
    source: `${file.label}, lines ${kept[0].n}–${kept.at(-1)!.n}`,
  };
}
