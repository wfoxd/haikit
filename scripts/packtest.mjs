#!/usr/bin/env node
/**
 * Publish-readiness test: pack the real tarballs, install them into a clean
 * directory outside the workspace, and use them.
 *
 * `npm test` cannot catch packaging bugs. Inside the workspace every import
 * resolves through a symlink to the source tree, so a missing entry in `files`,
 * a wrong `exports` path, a `.d.ts` that was never emitted, or a sourcemap
 * pointing at a file that is not in the tarball are all invisible — right up
 * until the first `npm install` by someone else.
 *
 * This installs what npm would actually serve.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "server", "client", "anthropic", "postgres"];

let pass = 0;
const failures = [];

const ok = (label) => {
  pass++;
  console.log(`  ✓ ${label}`);
};
const fail = (label, detail) => {
  failures.push({ label, detail });
  console.log(`  ✗ ${label}\n      ${String(detail).split("\n").join("\n      ")}`);
};
const check = (label, fn) => {
  try {
    const result = fn();
    result === false ? fail(label, "returned false") : ok(label);
  } catch (err) {
    fail(label, err.message ?? err);
  }
};

// tsc reports errors on stdout, not stderr, and execFileSync's default message
// is just "Command failed" — surface both streams or a failure says nothing.
const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed\n${output}`);
  }
};

const work = mkdtempSync(join(tmpdir(), "haikit-packtest-"));
const tarballs = join(work, "tarballs");
const consumer = join(work, "consumer");
run("mkdir", ["-p", tarballs, consumer]);

let exitCode = 0;
try {
  // ── 1. pack ────────────────────────────────────────────────────────────
  console.log("\npack");
  const tgz = {};
  for (const name of PACKAGES) {
    run("npm", ["pack", "--workspace", `@haikit/${name}`, "--pack-destination", tarballs], ROOT);
    const file = readdirSync(tarballs).find((f) => f.startsWith(`haikit-${name}-`));
    if (!file) throw new Error(`npm pack produced no tarball for @haikit/${name}`);
    tgz[name] = join(tarballs, file);
    ok(`@haikit/${name} → ${file}`);
  }

  // ── 2. tarball contents ────────────────────────────────────────────────
  // Everything the manifest promises has to actually be in the archive.
  console.log("\ntarball contents");
  for (const name of PACKAGES) {
    const listed = run("tar", ["-tzf", tgz[name]], work)
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^package\//, ""));
    const has = (f) => listed.includes(f);

    check(`@haikit/${name} ships LICENSE`, () => has("LICENSE"));
    check(`@haikit/${name} ships README.md`, () => has("README.md"));

    // Internal dependencies must name the version being released. The consumer
    // install below overrides every @haikit/* dependency with a local tarball,
    // so a stale pin — @haikit/postgres once required core 0.2.0, which lacks
    // the errors it imports — would install fine here and break every real
    // consumer. Check the manifest itself.
    check(`@haikit/${name} depends on this release of its siblings`, () => {
      const pkg = JSON.parse(run("tar", ["-xzOf", tgz[name], "package/package.json"], work));
      const stale = Object.entries(pkg.dependencies ?? {})
        .filter(([dep]) => dep.startsWith("@haikit/"))
        .filter(([dep, range]) => {
          const sibling = JSON.parse(readFileSync(join(ROOT, "packages", dep.slice(8), "package.json"), "utf8"));
          return range !== sibling.version;
        });
      if (stale.length) throw new Error(stale.map(([d, r]) => `${d}@${r}`).join(", "));
      return true;
    });

    const manifest = JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"));

    // every exports target resolves to a real entry in the archive
    check(`@haikit/${name} exports targets all present`, () => {
      const targets = [];
      const walk = (v) => {
        if (typeof v === "string") targets.push(v);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(manifest.exports);
      const missing = targets
        .filter((t) => !t.includes("*"))
        .map((t) => t.replace(/^\.\//, ""))
        .filter((t) => !has(t));
      if (missing.length) throw new Error(`not in tarball: ${missing.join(", ")}`);
      return true;
    });

    // sourcemaps point at ../src/*.ts — those files have to ship too, or
    // "go to definition" lands on nothing in every consumer's editor
    check(`@haikit/${name} sourcemap sources all present`, () => {
      const maps = listed.filter((f) => f.endsWith(".map"));
      if (!maps.length) return true; // client ships no maps
      const broken = [];
      for (const map of maps) {
        const body = JSON.parse(run("tar", ["-xzOf", tgz[name], `package/${map}`], work));
        for (const src of body.sources) {
          const resolved = join(dirname(map), src).replace(/\\/g, "/");
          if (!has(resolved)) broken.push(`${map} → ${src}`);
        }
      }
      if (broken.length) throw new Error(broken.join("\n"));
      return true;
    });
  }

  // ── 3. clean install ───────────────────────────────────────────────────
  // `overrides` is load-bearing: @haikit/server depends on @haikit/core@0.1.0,
  // which is not on the registry yet. Without it npm would try to fetch it.
  console.log("\nclean install (outside the workspace)");
  const fileDep = (name) => `file:${tgz[name]}`;
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "haikit-packtest-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@haikit/core": fileDep("core"),
          "@haikit/server": fileDep("server"),
          "@haikit/client": fileDep("client"),
          "@haikit/anthropic": fileDep("anthropic"),
          "@haikit/postgres": fileDep("postgres"),
          zod: "^4.0.0",
        },
        overrides: { "@haikit/core": fileDep("core") },
      },
      null,
      2,
    ),
  );

  check("npm install succeeds", () => {
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel", "error"], consumer);
    return true;
  });

  // ── 4. the installed packages actually work ────────────────────────────
  console.log("\nruntime (resolved through node_modules, not the workspace)");
  writeFileSync(
    join(consumer, "use.mjs"),
    `
import { defineSurface, resolve as resolveAction, query, makeCap, defineTool } from "@haikit/core";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { pgStore, migrate, schema, sweepOrphans } from "@haikit/postgres";
import { createChat } from "@haikit/client";
import { mountChat } from "@haikit/client/app.js";
import { renderTranscript, h } from "@haikit/client/transcript.js";
import { z } from "zod";

const out = {};
out.coreExports = [defineSurface, resolveAction, query, makeCap, defineTool].every(f => typeof f === "function");
out.serverExports = [createHai, memoryStore, nodeHandler].every(f => typeof f === "function");
out.anthropicExport = typeof anthropic === "function";
out.postgresExports = [pgStore, migrate, sweepOrphans].every((f) => typeof f === "function") && Array.isArray(schema);
// a store built from the tarball satisfies the adapter shape, with any driver
const pgShaped = pgStore({ query: async () => ({ rows: [] }) });
out.postgresIsStore = ["loadConversation", "saveConversation", "putPayload", "getPayload", "getPayloads"].every((m) => typeof pgShaped[m] === "function");
out.clientExports = [createChat, mountChat, renderTranscript, h].every(f => typeof f === "function");

// the contract layer does real work, not just re-export shapes
const surface = defineSurface({
  name: "packtest_picker",
  version: 1,
  props: z.object({ rows: z.array(z.string()) }),
  actions: { pick: resolveAction(z.string()) },
  queries: { filter: query(z.object({ q: z.string() })) },
});
out.surfaceName = surface.name;

// cap() is the guarantee that has to survive packaging — it is the only
// constructor for Capped, and it must report omissions
const cap = makeCap(47);
const capped = cap(Array.from({ length: 47 }, (_, i) => "row" + i), String, { maxRows: 3 });
out.capShown = capped.shown;
out.capTotal = capped.total;
out.capReportsOmission = capped.text.includes("47");

// the store round-trips a conversation. loadConversation acquires the turn
// lease, so the first load must be released before the second — exactly what
// the route does at the end of a request.
const store = memoryStore();
const convo = await store.loadConversation(undefined);
convo.leaseUntil = null;
await store.saveConversation(convo);
out.storeRoundTrip = (await store.loadConversation(convo.id)).id === convo.id;

// a runtime can be constructed from the installed packages alone
const hai = createHai({
  model: { id: "packtest", async send() { return { text: "", toolUses: [] }; } },
  store,
  tools: [],
  surfaces: [],
  system: "packtest",
});
out.handlerBuilt = typeof nodeHandler(hai, "/hai") === "function";

// the css is reachable through the exports map — the no-bundler path needs it
out.cssResolves = import.meta.resolve("@haikit/client/hai.css").endsWith("/src/hai.css");

console.log(JSON.stringify(out));
`,
  );

  let runtime = {};
  check("consumer script runs", () => {
    const out = run("node", ["use.mjs"], consumer);
    runtime = JSON.parse(out.trim().split("\n").at(-1));
    return true;
  });

  check("@haikit/core named exports", () => runtime.coreExports === true);
  check("@haikit/server named exports", () => runtime.serverExports === true);
  check("@haikit/anthropic named export", () => runtime.anthropicExport === true);
  check("@haikit/postgres named exports", () => runtime.postgresExports === true);
  check("@haikit/postgres builds a StoreAdapter", () => runtime.postgresIsStore === true);
  check("@haikit/client named exports (incl. subpaths)", () => runtime.clientExports === true);
  check("defineSurface builds a surface", () => runtime.surfaceName === "packtest_picker");
  check("cap() caps (3 of 47)", () => runtime.capShown === 3 && runtime.capTotal === 47);
  check("cap() reports the omission", () => runtime.capReportsOmission === true);
  check("memoryStore round-trips a conversation", () => runtime.storeRoundTrip === true);
  check("createHai + nodeHandler build", () => runtime.handlerBuilt === true);
  check("@haikit/client/hai.css resolves via exports", () => runtime.cssResolves === true);

  // ── 5. types resolve for a consumer ────────────────────────────────────
  // This is what catches a missing `types` condition or an unemitted .d.ts.
  // It is checked from outside the workspace so the source tree cannot help.
  console.log("\ntypes (nodenext resolution, from node_modules)");
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "es2023",
          lib: ["es2023", "dom"],
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          // our own .d.ts files are the thing under test — do not skip them
          skipLibCheck: false,
          // `types` is deliberately unset: a real consumer does not restrict it,
          // and @types/node must reach the program for `node:http` in
          // @haikit/server's public signature to resolve. If that dependency
          // ever goes missing from the manifest, nothing installs it and this
          // compile fails — which is the point.
        },
        files: ["use.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumer, "use.ts"),
    `
import { defineSurface, resolve as resolveAction, query, makeCap, type Capped, type StoreAdapter } from "@haikit/core";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { pgStore } from "@haikit/postgres";
import { createChat, type Registry, type MountCtx } from "@haikit/client";
import { mountChat } from "@haikit/client/app.js";
import { h } from "@haikit/client/transcript.js";
import { z } from "zod";

const picker = defineSurface({
  name: "t", version: 1,
  props: z.object({ rows: z.array(z.string()) }),
  actions: { pick: resolveAction(z.string()) },
  queries: { filter: query(z.object({ q: z.string() })) },
});

// a query must return Capped — this is the guarantee, seen from a consumer
const impl = picker.implement({
  digest: (props) => String(props.rows.length),
  actions: { pick: (v) => v },
  queries: { filter: (_args, { props, cap }): Capped => cap(props.rows, String) },
});
void impl;

// the client's hand-written types have to be real types, not implicit any
const registry: Registry = {
  t: { mount: (el: HTMLElement, props: { rows: string[] }, ctx: MountCtx) => {
    // tag-generic h(): .disabled only exists if the return type is narrowed
    const btn = h("button", "x", props.rows[0]);
    btn.disabled = ctx.state === "frozen";
    el.append(btn);
    return { freeze: () => { btn.disabled = true; } };
  } },
};
void registry;
// the store type-checks as a StoreAdapter, with a structurally-typed driver
const durable: StoreAdapter = pgStore({ query: async (_text: string, _params?: unknown[]) => ({ rows: [] }) });
void durable;
void createChat; void mountChat; void createHai; void memoryStore; void nodeHandler; void anthropic; void makeCap;
`,
  );

  check("consumer TypeScript compiles against the tarballs", () => {
    run("node", [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", consumer], consumer);
    return true;
  });

  // ── 6. the client is importable in a DOM-free context ──────────────────
  // It is browser code, but bundlers and SSR setups import it under Node.
  // Anything touching `document` at module scope would break them.
  check("@haikit/client has no module-scope DOM access", () => {
    run("node", ["--input-type=module", "-e", 'import("@haikit/client/app.js")'], consumer);
    return true;
  });
} catch (err) {
  fail("harness", err.stack ?? err.message ?? err);
} finally {
  const keep = process.argv.includes("--keep");
  if (keep) console.log(`\nworkdir kept: ${work}`);
  else rmSync(work, { recursive: true, force: true });
  // tarballs are written to a temp dir, but npm pack also leaves none in ROOT
  for (const f of readdirSync(ROOT).filter((f) => f.endsWith(".tgz"))) {
    rmSync(join(ROOT, f), { force: true });
  }
}

console.log(`\n${failures.length ? "✗" : "✓"} packtest: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.label}`);
  exitCode = 1;
}
process.exit(exitCode);
