/**
 * Verifies the negative type tests.
 *
 * Two passes:
 *   1. WITH @ts-expect-error — must be clean. An unused directive means the
 *      guarantee silently stopped working.
 *   2. WITHOUT the directives — every marked line must produce an error.
 *
 * Pass 1 alone is nearly enough (tsc reports unused expect-errors), but pass 2
 * also captures the actual message, so a regression shows what broke.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Each package with guarantees of its own: its test file, and the tsconfig
 * that compiles it, as `tsconfig.typetest.json` and, for the stripped copy,
 * `tsconfig.typetest-stripped.json` beside it.
 */
const SUITES = [
  {
    dir: "packages/core",
    verified: [
      "a surface cannot exist without a digest, nor a notice without its model text",
      "a query's return value can only be produced by cap()",
      'mode:"elicit" requires a declared resolve action',
      "an undeclared action does not exist",
    ],
  },
  {
    dir: "packages/mcp",
    verified: ["an MCP tool is not a HaiKIT tool: createHai's tools can't be given one", "MCP calls are typed by the app's own schemas"],
  },
];

const tsc = (args) => {
  try {
    return { ok: true, out: execFileSync("npx", ["tsc", ...args], { cwd: ROOT, encoding: "utf8" }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

console.log("building packages…");
const build = tsc(["-b", "packages/core", "packages/server", "packages/anthropic", "packages/openai", "packages/mcp"]);
if (!build.ok) {
  console.error(build.out);
  process.exit(1);
}

for (const suite of SUITES) {
  console.log(`\n${suite.dir}`);
  const src = path.join(ROOT, suite.dir, "test/types/guarantees.ts");

  // ── pass 1 ──────────────────────────────────────────────────────────
  const p1 = tsc(["-p", `${suite.dir}/tsconfig.typetest.json`, "--noEmit"]);
  if (!p1.ok) {
    console.error("✗ pass 1: guarantees.ts should compile cleanly with @ts-expect-error\n");
    console.error(p1.out);
    process.exit(1);
  }
  console.log("✓ pass 1 — every @ts-expect-error is load-bearing (no unused directives)");

  // ── pass 2 ──────────────────────────────────────────────────────────
  const source = readFileSync(src, "utf8");
  // Only real directives — a `*` docblock merely mentioning the token is prose.
  const DIRECTIVE = /^\s*\/\/ @ts-expect-error/;
  const expected = source
    .split("\n")
    .map((line, i) => (DIRECTIVE.test(line) ? i + 2 : null)) // the line it guards
    .filter((n) => n !== null);

  const dir = mkdtempSync(path.join(tmpdir(), "hai-typetest-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  const stripped = source.replace(/^(\s*)\/\/ @ts-expect-error.*$/gm, "$1//");
  const target = path.join(ROOT, suite.dir, "test/types/.guarantees.stripped.ts");
  writeFileSync(target, stripped);

  const p2 = tsc(["-p", `${suite.dir}/tsconfig.typetest-stripped.json`, "--noEmit"]);
  rmSync(target, { force: true });
  rmSync(dir, { recursive: true, force: true });

  if (p2.ok) {
    console.error("✗ pass 2: stripping @ts-expect-error produced NO errors — the guarantees are not enforced");
    process.exit(1);
  }

  const errorLines = new Set(
    [...p2.out.matchAll(/\.guarantees\.stripped\.ts\((\d+),\d+\)/g)].map((m) => Number(m[1])),
  );

  let failures = 0;
  for (const line of expected) {
    if (!errorLines.has(line)) {
      console.error(`✗ line ${line} was expected to fail, but compiled`);
      failures++;
    }
  }

  console.log(`✓ pass 2 — ${expected.length - failures}/${expected.length} guarded lines error when unguarded`);
  if (failures) process.exit(1);

  console.log("Guarantees verified:");
  suite.verified.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
}
