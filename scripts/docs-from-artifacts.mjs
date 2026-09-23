#!/usr/bin/env node
/**
 * Convert the published HTML artifacts into Markdown under docs/.
 *
 * The HTML is a presentation layer; docs/*.md is what lives in the repo — it
 * renders on GitHub, diffs cleanly, and can feed a docs site later.
 *
 * Walks the real DOM rather than matching regexes: these pages nest containers
 * several deep, and a non-greedy `</div>` stops at the first inner close, which
 * silently swallows whole sections.
 *
 * CSS/SVG diagrams have no Markdown form, so they are replaced by hand-authored
 * ASCII keyed on their container class.
 *
 *   node scripts/docs-from-artifacts.mjs <spec.html> <tutorial.html>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs");


// ── diagrams: no Markdown form, so hand-authored ────────────────────────
const DIAGRAMS = {
  split: "```\n" + `            search_flights() → 47 records
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
   MODEL CHANNEL             UI CHANNEL
   66 tok                    2,181 tok
   digest + handle ui_01     full props over SSE
   enters messages[],        never enters context,
   billed every turn         never billed

   97% of the payload stays out of context — measured, not estimated` + "\n```",

  contract: "```\n" + `            shared/surfaces.ts   ◀── THE CONTRACT
            props schema · action names · query names · version
                      │
      .implement({…}) ┴ .component(…)
            ┌─────────────────────┐
            ▼                     ▼
server/surfaces.ts          client/FlightTable.tsx
digest()      REQUIRED      props    typed from contract
actions       handlers      actions  typed from contract
queries       → Capped      local state (undeclared)
never reaches the browser   ↳ never round-trips` + "\n```",

  tl: "```\n" + ` BROWSER                          SERVER
 ───────                          ──────
 send("find flights")  ──────────▶ load conversation · acquire lease
                                   model.stream() → tool_use
                                   ctx.render(surface, elicit)
 ui_open · ui_props    ◀────────── full payload — UI channel only
 <FlightTable live/>        ■      no tool_result · status = awaiting
 connection closed          ⋮      minutes · hours · days
 user clicks row AC832 ──────────▶ {surface, action, value}
                                   tool_result = digest + selection
 text_delta …          ◀────────── resume the same turn` + "\n```",

  topo: "```\n" + `                  @haikit/core
            isomorphic · zero deps
   defineSurface() · defineTool() · Capped
   wire events · ModelAdapter · StoreAdapter
        ▲            ▲              ▲
        │            │              │
@haikit/server  @haikit/client   adapters
agent loop      createChat()     @haikit/anthropic
state machine   mountChat()      @haikit/store-pg
turn leases     renderTranscript
routes + SSE
handle store

@haikit/client must never import @haikit/server —
the only thing crossing that line is your contract module.` + "\n```",

  channels:
    `| channel | cost | what it carries |\n| --- | --- | --- |\n` +
    "| **Model** | ~60 tok | a digest + the handle `ui_01` — billed every turn |\n" +
    "| **UI** | ~1,900 tok | the full payload over SSE — never enters context |",
};

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

// ── inline ──────────────────────────────────────────────────────────────
/**
 * Markdown for ONE node, including its own wrapper. inline() formats a node's
 * children, so passing an <em> to it silently drops the emphasis — anything
 * walking siblings directly needs this instead.
 */
function inlineNode(c) {
  if (c.nodeType === 3) return c.rawText;
  const tag = c.rawTagName?.toLowerCase();
  const inner = inline(c);
  return tag === "code" ? "`" + decodeEntities(c.text).trim() + "`"
    : tag === "strong" || tag === "b" ? `**${inner.trim()}**`
    : tag === "em" || tag === "i" ? `*${inner.trim()}*`
    : tag === "br" ? " "
    : tag === "a" ? `[${inner.trim()}](${c.getAttribute("href")})`
    : inner;
}

function inline(node) {
  if (!node) return "";
  let out = "";
  for (const c of node.childNodes) out += inlineNode(c);
  return decodeEntities(out).replace(/\s+/g, " ");
}

const langFor = (p) =>
  /\.tsx?$/.test(p) ? "ts"
  : /\.jsx?$|\.mjs$/.test(p) ? "js"
  : /\.json$/.test(p) ? "json"
  : /\.html$/.test(p) ? "html"
  : /\.css$/.test(p) ? "css"
  : /terminal/i.test(p) ? "bash"
  : "text";

/**
 * node-html-parser keeps <pre> content as RAW TEXT (it is a block-text element),
 * so `pre code` matches nothing and any DOM walk comes back empty. Read the raw
 * inner HTML instead and unwrap it by hand — the parser is right for structure
 * and wrong for preformatted content.
 */
function preToText(pre) {
  if (!pre) return "";
  return decodeEntities(
    pre.rawText
      .replace(/<span class="anno">(\d+)<\/span>/g, (_, n) => `// ${n}`)
      .replace(/<span class="anno[^"]*">[^<]*<\/span>/g, "// ↳")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function codeOf(fig) {
  return preToText(fig.querySelector("pre"));
}

/**
 * One annotation. A nested <dl class="defs"> becomes an indented bullet list
 * rather than being flattened into the sentence — inline() would run the terms
 * and their definitions together into unreadable prose.
 *
 * The <dl> sits inside the annotation's text span, not directly under the <li>,
 * so the split has to descend rather than scan one level.
 */
function splitAround(node, target) {
  let before = "", after = "", passed = false;
  for (const c of node.childNodes) {
    if (c === target) {
      passed = true;
      continue;
    }
    if (c.nodeType === 1 && c.querySelector?.("dl.defs")) {
      const [b, a] = splitAround(c, target);
      before += b;
      after += a;
      passed = true;
      continue;
    }
    const t = inlineNode(c);
    if (passed) after += t;
    else before += t;
  }
  return [before, after];
}

function annotationMd(li) {
  const marker = li.querySelector(".anno")?.text.trim() ?? "";
  li.querySelector(".anno")?.remove();
  const glyph = /^\d+$/.test(marker) ? `**${marker}**` : "↳";

  const dl = li.querySelector("dl.defs");
  if (!dl) return `${glyph} ${inline(li).trim()}`;

  const pairs = [];
  let term = null;
  for (const d of dl.childNodes.filter((n) => n.nodeType === 1)) {
    if (d.rawTagName.toLowerCase() === "dt") term = inline(d).trim();
    else if (term) {
      pairs.push(`  - **\`${term}\`** — ${inline(d).trim()}`);
      term = null;
    }
  }

  const [before, after] = splitAround(li, dl);
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  return [glyph + " " + norm(before), pairs.join("\n"), norm(after)].filter(Boolean).join("\n\n");
}

function figureMd(fig) {
  const p = fig.querySelector(".path")?.text.trim() ?? "";
  const flag = fig.querySelector(".flag")?.text.trim() ?? "";
  return `**\`${p}\`**${flag ? ` — *${flag}*` : ""}\n\n\`\`\`${langFor(p)}\n${codeOf(fig)}\n\`\`\``;
}

function tableMd(t) {
  const rows = t.querySelectorAll("tr").map((r) =>
    r.querySelectorAll("th,td").map((c) => inline(c).trim()),
  );
  if (!rows.length) return "";
  const head = rows[0];
  return (
    `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n` +
    rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n")
  );
}

// ── walk ────────────────────────────────────────────────────────────────
function walk(node, out) {
  for (const el of node.childNodes) {
    if (el.nodeType !== 1) continue;
    const tag = el.rawTagName?.toLowerCase();
    const cls = (el.classNames ?? "").trim();
    const has = (c) => el.classList?.contains(c);

    if (DIAGRAMS[cls]) {
      out.push(DIAGRAMS[cls]);
      continue;
    }

    if (tag === "h1" || tag === "h2") out.push(`## ${inline(el).trim()}`);
    else if (tag === "h3") out.push(`### ${inline(el).trim()}`);
    else if (has("step-head")) {
      const n = el.querySelector(".step-n")?.text.trim() ?? "";
      const t = el.querySelector("h2");
      out.push(`## ${n && n !== "→" ? n + " · " : ""}${inline(t).trim()}`);
    } else if (tag === "figure" && has("code")) out.push(figureMd(el));
    else if (tag === "ol" && has("annotations")) {
      out.push(el.querySelectorAll("li").map(annotationMd).join("\n\n"));
    } else if (has("callout")) {
      const kind = has("warn") ? "WARNING" : has("check") ? "TIP" : "NOTE";
      const tagEl = el.querySelector(".tag");
      const label = tagEl?.text.trim() ?? "";
      tagEl?.remove();
      const ps = el.querySelectorAll("p").map((p) => inline(p).trim()).filter(Boolean);
      out.push(`> [!${kind}]\n> **${label}**\n>\n` + ps.map((t) => `> ${t}`).join("\n>\n"));
    } else if (has("note")) {
      out.push("> " + inline(el).trim());
    } else if (tag === "dl" && has("defs")) {
      const pairs = [];
      let term = null;
      for (const c of el.childNodes.filter((n) => n.nodeType === 1)) {
        if (c.rawTagName.toLowerCase() === "dt") term = inline(c).trim();
        else if (term) {
          pairs.push(`- **\`${term}\`** — ${inline(c).trim()}`);
          term = null;
        }
      }
      out.push(pairs.join("\n"));
    } else if (has("blk")) {
      const name = el.querySelector(".blk-name")?.text.trim() ?? "";
      const sig = el.querySelector(".blk-sig")?.text.trim() ?? "";
      const destEl = el.querySelector(".blk-dest");
      const dest = inline(destEl).trim();
      destEl?.remove();
      const ps = el.querySelectorAll("p").map((p) => inline(p).trim()).filter(Boolean);
      out.push(`### \`${name}\`\n\n\`\`\`ts\n${name}${sig}\n\`\`\`\n\n${dest}\n\n${ps.join("\n\n")}`);
    } else if (has("guards")) {
      const rows = el.querySelectorAll(".guard").map((g) => [
        inline(g.querySelector(".guard-fail")).replace(/^\s*✗\s*/, "").trim(),
        inline(g.querySelector(".guard-fix")).trim(),
      ]);
      out.push(
        `| Failure mode | Prevented by |\n| --- | --- |\n` +
          rows.map((r) => `| ${r[0]} | ${r[1]} |`).join("\n"),
      );
    } else if (tag === "table") out.push(tableMd(el));
    else if (tag === "details") {
      const sum = el.querySelector("summary");
      const label = inline(sum).trim() || "details";
      sum?.remove();
      const inner = [];
      walk(el, inner);
      out.push(`<details>\n<summary>${label}</summary>\n\n${inner.join("\n\n")}\n\n</details>`);
    } else if (tag === "ul" || tag === "ol") {
      const bullet = tag === "ol" ? (i) => `${i + 1}.` : () => "-";
      out.push(
        el.querySelectorAll("li").map((li, i) => `${bullet(i)} ${inline(li).trim()}`).join("\n"),
      );
    } else if (tag === "p") {
      const t = inline(el).trim();
      if (t) out.push(t);
    } else if (tag === "pre") {
      out.push("```\n" + preToText(el) + "\n```");
    } else {
      walk(el, out); // plain container — descend
    }
  }
}

function convert(html, { title, intro }) {
  const root = parse(html);
  for (const n of root.querySelectorAll("style, script, nav, svg")) n.remove();
  const out = [];
  walk(root, out);
  return (`# ${title}\n\n> ${intro}\n\n` + out.filter(Boolean).join("\n\n") + "\n").replace(
    /\n{4,}/g,
    "\n\n\n",
  );
}

// ── coverage: a converter that silently drops sections is worse than none ─
function coverage(html, md, label) {
  const root = parse(html);
  for (const n of root.querySelectorAll("style, script, nav, svg, pre")) n.remove();
  for (const k of Object.keys(DIAGRAMS)) for (const n of root.querySelectorAll(`.${k}`)) n.remove();

  // Normalise both sides to alphanumeric tokens. Anything softer mismatches on
  // punctuation: `*interface*,` collapses to "interface ," on one side and
  // "interface," on the other.
  const norm = (x) =>
    decodeEntities(x)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const hay = norm(md);
  const missing = new Set();
  for (const el of root.querySelectorAll(
    "p, li, dd, h1, h2, h3, summary, td, th, .guard-fail, .guard-fix",
  )) {
    // annotation items open with a marker digit glued to the text ("1three…");
    // Markdown renders it as a separate glyph, so drop it from the probe
    const n = norm(el.text).replace(/^\d+(?=[a-z])/, "").replace(/^\d+\s/, "");
    if (n.length < 40) continue;
    const probe = n.split(" ").slice(0, 8).join(" ");
    if (probe.length > 20 && !hay.includes(probe)) missing.add(n.slice(0, 72));
  }

  // Code blocks were invisible to this check until they came back empty.
  const htmlCode = parse(html).querySelectorAll("pre");
  const mdCode = md.split("```").filter((_, i) => i % 2 === 1)
    .map((b) => b.replace(/^[a-z]*\n/, "").trim());
  const emptyMd = mdCode.filter((b) => !b).length;
  if (htmlCode.length && (emptyMd || mdCode.length < htmlCode.length)) {
    console.error(
      `  ✗ ${label}: ${htmlCode.length} code blocks in HTML, ` +
      `${mdCode.length} in Markdown, ${emptyMd} of them empty`,
    );
    return false;
  }

  if (missing.size) {
    console.error(`  ✗ ${label}: ${missing.size} block(s) dropped:`);
    for (const x of [...missing].slice(0, 10)) console.error("     … " + x);
    return false;
  }
  console.log(`  ✓ ${label}: every prose block survived`);
  return true;
}

// ── run ─────────────────────────────────────────────────────────────────
const [specPath, tutPath] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const jobs = [
  [specPath, "spec.md", {
    title: "haikit — design spec",
    intro:
      "A framework for LLM tools that return interactive UI alongside a token-cheap " +
      "digest. One tool execution produces two outputs: a digest for the model, a " +
      "payload for the browser.",
  }],
  [tutPath, "tutorial.md", {
    title: "Build a haikit app",
    intro:
      "Hello, World! in whichever language the world picks — the smallest app that " +
      "still shows what haikit is for. Nine steps, annotated line by line.",
  }],
];

let ok = true;
for (const [src, name, meta] of jobs) {
  const html = readFileSync(src, "utf8");
  writeFileSync(path.join(OUT, name), convert(html, meta));
  ok = coverage(html, readFileSync(path.join(OUT, name), "utf8"), name) && ok;
}

console.log(ok ? "\nwrote docs/spec.md and docs/tutorial.md" : "\nconversion is lossy — fix before committing");
process.exit(ok ? 0 : 1);
