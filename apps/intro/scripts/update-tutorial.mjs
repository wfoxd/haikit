/**
 * Refresh content/tutorial.md from HaiKIT's repository.
 *
 * The app carries its own copy of docs/tutorial.md so it stays self-contained
 * (the tutorial isn't in the npm packages). Run this to pick up the latest,
 * then `npm test`: the server parses the tutorial when it starts, so anything
 * the parser can't read fails there, with the line it couldn't place.
 *
 *   npm run tutorial:update
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://raw.githubusercontent.com/wfoxd/haikit/main/docs/tutorial.md";
const TARGET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../content/tutorial.md");

const res = await fetch(URL);
if (!res.ok) {
  console.error(`could not fetch ${URL}: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();
await writeFile(TARGET, text);
console.log(`content/tutorial.md updated: ${text.split("\n").length} lines from ${URL}`);
