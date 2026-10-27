/**
 * Refresh content/ from HaiKIT's repository: the three tutorials, and every
 * page of the reference manual.
 *
 * The app carries its own copies of docs/tutorial.md, docs/tutorial-2.md,
 * docs/tutorial-3.md and docs/reference/ so it stays self-contained (none of them are in the npm
 * packages). Run this to pick up the latest, then `npm test`: the server parses
 * them when it starts, so anything the parsers can't read, or a reference link
 * that leads nowhere, fails there, with the line or the link.
 *
 * The reference's pages are the ones its index links to. A page the index no
 * longer links to is deleted here, so the copy holds what the manual holds.
 *
 *   npm run docs:update
 */

import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/wfoxd/haikit/main/docs";
const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content");
const REFERENCE = path.join(CONTENT, "reference");

/** Fetch one file of docs/, or stop with the URL that failed. */
async function fetchDoc(file) {
  const url = `${BASE}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`could not fetch ${url}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return { url, text: await res.text() };
}

/** Write a fetched file under content/, and say so. */
async function save(file, { url, text }) {
  await writeFile(path.join(CONTENT, file), text);
  console.log(`content/${file} updated: ${text.split("\n").length} lines from ${url}`);
}

for (const file of ["tutorial.md", "tutorial-2.md", "tutorial-3.md"]) await save(file, await fetchDoc(file));

// The index first: the pages it links to are the manual.
const index = await fetchDoc("reference/index.md");
const pages = [...new Set([...index.text.matchAll(/\]\(([\w-]+)\.md[#)]/g)].map((m) => m[1]))];
await save("reference/index.md", index);
for (const page of pages) await save(`reference/${page}.md`, await fetchDoc(`reference/${page}.md`));

const keep = new Set(["index.md", ...pages.map((p) => `${p}.md`)]);
for (const file of await readdir(REFERENCE)) {
  if (file.endsWith(".md") && !keep.has(file)) {
    await rm(path.join(REFERENCE, file));
    console.log(`content/reference/${file} deleted: the index no longer links to it`);
  }
}
