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
 * Rules that reach past the default UI's own elements and set anything but a
 * custom property. Only the tokens on :root, keyframe steps and the one
 * documented page rule, the body's margin under the shell, may.
 */
function beyondShell(css) {
  const found = [];
  for (const [, selector, body] of css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const s = selector.trim();
    if (/\.hai[-\\]|:root|^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/.test(s)) continue;
    const declarations = body.split(";").map((d) => d.trim()).filter(Boolean);
    if (declarations.some((d) => !d.startsWith("--"))) found.push(`${s} { ${declarations.join("; ")} }`);
  }
  return found;
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
};

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
  check("font-hai-mono, rounded-hai and shadow-hai are the tokens", rule("font-hai-mono").includes("var(--hai-mono)") && rule("rounded-hai").includes("var(--hai-radius)") && css.includes("var(--hai-shadow)"));
  check("emits no theme variables of its own", !/--color-hai-/.test(css));
  check("brings the default UI's stylesheet with it", css.includes(".hai-shell {") && css.includes("--hai-panel: light-dark("));
  check("leaves the app's dark variant alone", !/@custom-variant/.test(readFileSync(join(ROOT, "packages/client/src/tailwind.css"), "utf8")));
}

console.log(failures ? `\ncss: ${failures} failed` : "\ncss: all checks passed");
process.exit(failures ? 1 : 0);
