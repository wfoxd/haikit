#!/usr/bin/env node
/**
 * Rename the npm scope across the whole repo.
 *
 *   node scripts/rename-scope.mjs @haikit
 *   node scripts/rename-scope.mjs @yourname     # a user scope always works
 *
 * npm scope availability cannot be checked programmatically — `npm view
 * @scope/pkg` 404s whether the scope is free or merely empty, and the registry
 * search API ignores `scope:` filters entirely (scope:angular returns zero).
 * The only real check is creating the org at npmjs.com/org/create.
 *
 * So treat the scope as reversible: pick one, and if it turns out to be taken,
 * run this again. It touches manifests, import specifiers, docs and the
 * changeset config in one pass.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const next = process.argv[2];

if (!next || !/^@[a-z0-9][a-z0-9-._]*$/.test(next)) {
  console.error("usage: node scripts/rename-scope.mjs @newscope");
  process.exit(1);
}

// current scope, read from the core package rather than hardcoded
const corePkg = JSON.parse(readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"));
const prev = corePkg.name.split("/")[0];
if (prev === next) {
  console.log(`already ${next}`);
  process.exit(0);
}

const SKIP = new Set(["node_modules", "dist", ".git", ".changeset"]);
const EXT = new Set([".ts", ".js", ".mjs", ".json", ".md", ".yml", ".html"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(full))) yield full;
  }
}

let changed = 0;
for (const file of walk(ROOT)) {
  const before = readFileSync(file, "utf8");
  const after = before.replaceAll(`${prev}/`, `${next}/`);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}

// the changeset config lives in a skipped dir, so handle it explicitly
const csPath = path.join(ROOT, ".changeset/config.json");
try {
  const cs = readFileSync(csPath, "utf8");
  writeFileSync(csPath, cs.replaceAll(`${prev}/`, `${next}/`));
  changed++;
} catch {}

console.log(`${prev} → ${next}  (${changed} files)`);
console.log("run `npm install` to relink the workspace, then `npm test`");
