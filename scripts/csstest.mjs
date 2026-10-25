/**
 * @haikit/client's stylesheets. src/hai.css is generated from
 * packages/client/styles and committed, so it has to be what the build would
 * write now, and nothing but plain CSS a page can load as it is. And
 * @haikit/client/tailwind.css, in a Tailwind app, has to bring that
 * stylesheet with it and give the app HaiKIT's tokens as theme values.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { buildHaiCss, OUT } from "./build-css.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What a stylesheet sets beyond the default UI's own elements, one selector at
 * a time, so a list that names a shell class and a page element is caught by
 * the page element. Anything may set custom properties, and `@property` may
 * register them. Beyond that, a selector has to name a `.hai-` or `.hai:`
 * class, other than inside `:has()` or `:not()`, where it doesn't make the
 * element one of the shell's. The exceptions:
 *   - keyframe steps;
 *   - the page root, which may set `color-scheme` (the tokens are custom
 *     properties already);
 *   - the body's margin under the shell, the one documented page rule.
 */
function beyondShell(css) {
  const found = [];
  for (const [, prelude, body] of css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    const at = prelude.trim();
    const properties = body.split(";").map((d) => d.split(":")[0].trim()).filter(Boolean);
    const styled = properties.filter((p) => !p.startsWith("--"));
    if (!styled.length || at.startsWith("@property ") || /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(at)) continue;
    for (const selector of topLevel(at, ",")) {
      if (/^(:where\()?:root(\[[^\]]*\])?\)?$/.test(selector) && styled.every((p) => p === "color-scheme")) continue;
      if (selector === ":where(body:has(.hai-shell))" && styled.every((p) => p === "margin")) continue;
      if (/\.hai[-\\]/.test(withoutArguments(selector, ["has", "not"]))) continue;
      found.push(`${selector} { ${styled.join("; ")} }`);
    }
  }
  return found;
}

/** `s` split at each `sep` outside brackets and parentheses, trimmed. */
function topLevel(s, sep) {
  const parts = [""];
  let depth = 0;
  for (const c of s) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === sep && !depth) parts.push("");
    else parts[parts.length - 1] += c;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** `selector` with the arguments of these functional pseudo-classes taken out. */
function withoutArguments(selector, names) {
  let out = "";
  for (let i = 0; i < selector.length; i++) {
    const name = names.find((n) => selector.startsWith(`:${n}(`, i));
    if (!name) {
      out += selector[i];
      continue;
    }
    out += `:${name}()`;
    let depth = 0;
    for (i += name.length + 1; i < selector.length; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")" && !--depth) break;
    }
  }
  return out;
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
};

console.log("the scope check");
{
  // the check has to catch these, or a pass below means nothing
  const caught = (css) => beyondShell(css).length > 0;
  check("catches a page element listed beside a shell class", caught(".hai-btn, button { color: red; }"));
  check("catches the page root styled", caught(":root { margin: 0; }") && caught(":where(:root) { color-scheme: dark; margin: 0; }"));
  check("catches a shell class only inside :not() or :has()", caught("button:not(.hai-btn) { color: red; }") && caught("div:has(.hai-surface) { padding: 0; }"));
  check("catches the body rule styling more than its margin", caught(":where(body:has(.hai-shell)) { margin: 0; color: red; }"));
  check("catches a reset (preflight)", caught("*, ::after, ::before { box-sizing: border-box; margin: 0; }"));
  // and let these through
  const passed = (css) => beyondShell(css).length === 0;
  check(
    "passes shell rules, tokens, keyframes, custom properties and the body's margin",
    passed(".hai-empty p { margin: 0; }\n.hai\\:flex { display: flex; }\n.hai-tool:has(+ .hai-surface) { box-shadow: none; }") &&
      passed(':where(:root) { color-scheme: light dark; --hai-bg: red; }\n:where(:root[data-hai-theme="dark"]) { color-scheme: dark; }') &&
      passed("@keyframes k { 0%, 100% { opacity: 1; } }\n*, :before { --tw-border-style: solid; }") &&
      passed('@property --tw-border-style { syntax: "*"; inherits: false; }\n:where(body:has(.hai-shell)) { margin: 0; }'),
  );
}

console.log("hai.css");
{
  const committed = readFileSync(OUT, "utf8");
  check("is what npm run build:css writes now", committed === (await buildHaiCss()), "run npm run build:css and commit packages/client/src/hai.css");
  // Tailwind's own at-rules would reach the browser as they are, and do nothing
  const leftover = committed.match(/@(tailwind|theme|source|custom-variant|apply|utility|variant|plugin|config)\b/);
  check("has no Tailwind at-rules left in it", !leftover, `found ${leftover?.[0]}`);
  const outside = beyondShell(committed);
  check("styles nothing outside the default UI but custom properties (no preflight)", !outside.length, outside.slice(0, 3).join("\n      "));
}

console.log("classes.js");
{
  const cls = await import("../packages/client/src/classes.js");
  const strings = Object.entries(cls).flatMap(([name, v]) => (typeof v === "string" ? [[name, v]] : Object.entries(v).map(([k, s]) => [`${name}.${k}`, s])));
  // Tailwind drops a class it doesn't know without a word, so each must add a
  // rule of its own. A compiler's build is cumulative, so each is measured by
  // what it adds to the ones before it.
  const styles = join(ROOT, "packages/client/styles");
  const compiler = await compile(readFileSync(join(styles, "utilities.css"), "utf8"), { base: styles, onDependency() {} });
  const utilities = [...new Set(strings.flatMap(([, s]) => s.split(/\s+/)).filter((c) => c.startsWith("hai:")))];
  let before = compiler.build([]).length;
  const dead = utilities.filter((c) => {
    const now = compiler.build([c]).length;
    const added = now > before;
    before = now;
    return !added;
  });
  check(`each of its ${utilities.length} utilities compiles to a rule`, !dead.length, dead.slice(0, 5).join(" "));
  // with padding or a border, an element's size depends on its box-sizing, which a page's reset would otherwise choose
  const unsized = strings
    .filter(([, s]) => /(^|\s)hai:(p[xytrbl]?-(?!0(\s|$))|border(-[xytrbl])?-[1-9])/.test(s) && !/(^|\s)hai:box-(border|content)(\s|$)/.test(s))
    .map(([name]) => name);
  check("every element with padding or a border sets its box-sizing", !unsized.length, unsized.join(", "));
  // outline-none clears --tw-outline-style, which a width utility reads, and
  // keyboard focus matches :focus too: a ring drawn over it names its style
  const ringless = strings
    .filter(([, s]) => /(^|\s)hai:focus:outline-none(\s|$)/.test(s) && /(^|\s)hai:focus-visible:outline-\d/.test(s) && !/(^|\s)hai:focus-visible:outline-(solid|dashed|dotted|double)(\s|$)/.test(s))
    .map(([name]) => name);
  check("a focus ring drawn over a hidden outline names its style", !ringless.length, ringless.join(", "));
}

console.log("tailwind.css, in a Tailwind app");
{
  // resolved from the repo root, where @haikit/client is the workspace's own
  const app = await compile('@import "tailwindcss";\n@import "@haikit/client/tailwind.css";\n', { base: ROOT, onDependency() {} });
  const css = app.build(["bg-hai-panel", "text-hai-dim", "border-hai-line", "bg-hai-accent/50", "font-hai-mono", "rounded-hai", "shadow-hai"]);
  const rule = (cls) => css.match(new RegExp(`\\.${cls.replace(/[/]/g, "\\\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  check("bg-hai-panel is the --hai-panel token", rule("bg-hai-panel").includes("var(--hai-panel)"));
  check("text-hai-dim is the --hai-dim token", rule("text-hai-dim").includes("var(--hai-dim)"));
  check("border-hai-line is the --hai-line token", rule("border-hai-line").includes("var(--hai-line)"));
  check("an opacity modifier mixes the token", /color-mix\([^)]*var\(--hai-accent\) 50%/.test(css));
  check("font-hai-mono, rounded-hai and shadow-hai are the tokens", rule("font-hai-mono").includes("var(--hai-mono)") && rule("rounded-hai").includes("var(--hai-radius)") && rule("shadow-hai").includes("var(--hai-shadow)"));
  check("emits no theme variables of its own", !/--color-hai-/.test(css));
  check("brings the default UI's stylesheet with it", css.includes("--hai-panel: light-dark(") && css.includes(".hai\\:flex {"));
  check("leaves the app's dark variant alone", !/@custom-variant/.test(readFileSync(join(ROOT, "packages/client/src/tailwind.css"), "utf8")));
}

console.log(failures ? `\ncss: ${failures} failed` : "\ncss: all checks passed");
process.exit(failures ? 1 : 0);
