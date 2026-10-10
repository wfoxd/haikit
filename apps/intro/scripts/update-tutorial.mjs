/**
 * Refresh content/tutorial.md and content/tutorial-2.md from HaiKIT's
 * repository.
 *
 * The app carries its own copies of docs/tutorial.md and docs/tutorial-2.md so
 * it stays self-contained (the tutorials aren't in the npm packages). Run this
 * to pick up the latest, then `npm test`: the server parses the tutorials when
 * it starts, so anything the parser can't read fails there, with the line it
 * couldn't place.
 *
 *   npm run tutorial:update
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/wfoxd/haikit/main/docs";
const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content");

for (const file of ["tutorial.md", "tutorial-2.md"]) {
  const url = `${BASE}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`could not fetch ${url}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const text = await res.text();
  await writeFile(path.join(CONTENT, file), text);
  console.log(`content/${file} updated: ${text.split("\n").length} lines from ${url}`);
}
