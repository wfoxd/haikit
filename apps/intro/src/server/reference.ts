/**
 * HaiKIT's reference manual, built into this app.
 *
 * content/reference/ is a copy of docs/reference/ from the haikit repository;
 * `npm run docs:update` refreshes it. Each page is parsed here once, when the
 * server starts, into the blocks the browser shows. The manual's pages, in
 * order, are its index (the contents) and then the pages the index links to,
 * in the order it first links to them.
 *
 * The parser knows the Markdown the manual uses: ## to #### headings,
 * paragraphs, tables, fenced code, and lists whose items hold paragraphs, code
 * and lists of their own. Every link is rewritten to a target the browser
 * follows without resolving a path (see `Block` in ../shared/surfaces.ts), and
 * checked: a link to a page or a section that doesn't exist stops the server
 * with the page, the line and the link, as does Markdown the parser doesn't
 * know. So a change upstream fails `npm test` rather than showing a broken page.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Block, ReferenceRef } from "../shared/surfaces.ts";

export interface ReferencePage {
  /** The file's name without .md: "index", "concepts", "surfaces" … */
  id: string;
  /** Its # heading, such as "Surfaces". */
  title: string;
  /** How menus and buttons name it: its title, or "Contents" for the index. */
  label: string;
  /** Its first paragraph as plain text, for the model's digest. */
  lead: string;
  blocks: Block[];
  /** Every heading's anchor, and the heading as plain text. */
  anchors: Map<string, string>;
}

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../content/reference");
/** Where the manual's links to the rest of docs/ lead: the files on GitHub. */
const DOCS = "https://github.com/wfoxd/haikit/blob/main/docs/";

const FENCE = /^(\s*)```(\w*)\s*$/;
const FENCE_END = /^\s*```\s*$/;
const HEADING = /^(#{2,4}) (.+)$/;
/** A list item, at the start of a line: lines are dedented before a list's items are read. */
const ITEM = /^([-*]|\d+\.) (.*)$/;
const LANGS = ["ts", "tsx", "js", "json", "css", "html", "bash", "text"] as const;

/** A line of a page, and its number in the file, for errors. */
type Line = { t: string; n: number };

/** What's wrong at a line of the manual, and what to do about it: by default, teach the parser. */
class ManualError extends Error {
  constructor(what: string, file: string, line: number, fix = "Update src/server/reference.ts to read it") {
    super(`content/reference/${file}, line ${line}: ${what}. ${fix}.`);
  }
}

/** A link that leads nowhere is the manual's to fix, not the parser's. */
const fixLink = (file: string) => `Fix it in docs/reference/${file}, then run npm run docs:update`;

/** A heading's anchor, as GitHub makes it, so the manual's own links work unchanged. */
export const slug = (heading: string) =>
  heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "").replaceAll(" ", "-");

/** Inline Markdown as plain text: a link's label, code without its backticks, no emphasis. */
export const plain = (text: string) =>
  text.replace(/\[((?:`[^`]*`|[^\]`])+)\]\([^)\s]+\)/g, "$1").replace(/[`*]/g, "");

const indentOf = (t: string) => t.length - t.trimStart().length;
const blank = (l: Line | undefined) => !l || !l.t.trim();

/** One file of the manual, read into blocks. Its links are checked once every page is read. */
function parsePage(file: string, markdown: string) {
  const id = file.replace(/\.md$/, "");
  const lines: Line[] = markdown.replace(/\r\n/g, "\n").split("\n").map((t, i) => ({ t, n: i + 1 }));
  const title = lines[0]?.t.match(/^# (.+)$/)?.[1]?.trim();
  if (!title) throw new ManualError("no # title on the first line", file, 1);

  const anchors = new Map<string, string>();
  const seen = new Map<string, number>([[slug(title), 1]]);
  const links: { href: string; n: number }[] = [];

  /** A link's target, written so the browser can follow it without resolving a path. */
  const target = (href: string, n: number) => {
    if (/^#[\w-]+$/.test(href)) return href;
    const page = href.match(/^([\w-]+)\.md(#[\w-]+)?$/);
    if (page) return `ref:${page[1]}${page[2] ?? ""}`;
    const doc = href.match(/^\.\.\/([\w-]+\.md)$/)?.[1];
    if (doc === "tutorial.md") return "tutorial:intro";
    if (doc === "tutorial-2.md") return "tutorial:2-intro";
    if (doc === "tutorial-3.md") return "tutorial:3-intro";
    if (doc) return DOCS + doc;
    if (/^https:\/\/[^\s]+$/.test(href)) return href;
    throw new ManualError(`a link it can't follow: ${href}`, file, n);
  };

  /** Inline text with each link's target rewritten, leaving code spans alone (`a`, or ``a `b` c``). */
  const inline = (text: string, n: number) =>
    text.replace(/((?<!`)(`+)(?!`).+?(?<!`)\2(?!`))|\[((?:`[^`]*`|[^\]`])+)\]\(([^)\s]+)\)/g, (whole, code, _ticks, label, href) => {
      if (code) return whole;
      const to = target(href, n);
      links.push({ href: to, n });
      return `[${label}](${to})`;
    });

  /** Where a paragraph ends: a blank line, or a line that starts a block of its own. */
  const startsBlock = (t: string) =>
    FENCE.test(t) || HEADING.test(t) || t.startsWith("|") || /^([-*]|1\.) /.test(t);

  function blocksOf(lines: Line[]): Block[] {
    const blocks: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (blank(line)) {
        i++;
        continue;
      }

      const fence = line.t.match(FENCE);
      if (fence) {
        const indent = fence[1]!.length;
        const body: string[] = [];
        i++;
        while (i < lines.length && !FENCE_END.test(lines[i]!.t)) body.push(lines[i++]!.t.slice(indent));
        if (i >= lines.length) throw new ManualError("a code fence that never closes", file, line.n);
        i++;
        const lang = (LANGS as readonly string[]).includes(fence[2]!) ? (fence[2] as (typeof LANGS)[number]) : "text";
        blocks.push({ kind: "code", lang, code: body.join("\n") });
        continue;
      }

      const heading = line.t.match(HEADING);
      if (heading) {
        const text = heading[2]!.trim();
        const base = slug(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const anchor = count ? `${base}-${count}` : base;
        anchors.set(anchor, plain(text));
        blocks.push({ kind: "h", level: heading[1]!.length, id: anchor, text: inline(text, line.n) });
        i++;
        continue;
      }

      if (line.t.startsWith("|")) {
        const rows: string[][] = [];
        while (i < lines.length && lines[i]!.t.startsWith("|")) {
          const { t, n } = lines[i++]!;
          // split at the pipes that aren't escaped, then unescape the ones that are
          const cells = t.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/)
            .map((c) => c.trim().replaceAll("\\|", "|"));
          if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells.map((c) => inline(c, n)));
        }
        blocks.push({ kind: "table", head: rows[0] ?? [], rows: rows.slice(1) });
        continue;
      }

      const first = line.t.match(ITEM);
      if (first) {
        const ordered = /\d/.test(first[1]!);
        const items: Block[][] = [];
        while (i < lines.length) {
          const item = lines[i]!.t.match(ITEM);
          if (!item || /\d/.test(item[1]!) !== ordered) break;
          // what the item holds is indented under its text, past the marker
          const width = item[1]!.length + 1;
          const content: Line[] = [{ t: item[2]!, n: lines[i]!.n }];
          let fenced = false;
          i++;
          while (i < lines.length) {
            const l = lines[i]!;
            if (blank(l)) {
              // a blank line: the item goes on only if what follows is indented under it
              let j = i;
              while (blank(lines[j]) && j < lines.length) j++;
              if (j >= lines.length || indentOf(lines[j]!.t) < width) break;
              for (; i < j; i++) content.push({ t: "", n: lines[i]!.n });
              continue;
            }
            const under = indentOf(l.t) >= width;
            // an unindented line carries on the item's paragraph, unless it starts something new
            const lazy = !under && !fenced && !blank(content.at(-1)) && !startsBlock(l.t) && !ITEM.test(l.t);
            if (!under && !lazy) break;
            const t = under ? l.t.slice(width) : l.t.trim();
            if (FENCE.test(t)) fenced = !fenced; // opens one, or closes it
            content.push({ t, n: l.n });
            i++;
          }
          items.push(blocksOf(content));
          // blank lines between two items of one list
          let j = i;
          while (blank(lines[j]) && j < lines.length) j++;
          const next = lines[j]?.t.match(ITEM);
          if (j > i && next && /\d/.test(next[1]!) === ordered) i = j;
        }
        const start = ordered ? Number.parseInt(first[1]!, 10) : 1;
        blocks.push({ kind: "items", ordered, ...(start !== 1 ? { start } : {}), items });
        continue;
      }

      if (/^(>|<|#|---|\s)/.test(line.t)) {
        throw new ManualError(`Markdown it doesn't know: ${line.t.trim().slice(0, 40)}`, file, line.n);
      }

      // a paragraph: this line and the ones after it, up to a blank or a block
      const text = [line.t.trim()];
      i++;
      while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i]!.t)) text.push(lines[i++]!.t.trim());
      blocks.push({ kind: "p", text: inline(text.join(" "), line.n) });
    }
    return blocks;
  }

  const blocks = blocksOf(lines.slice(1));
  const lead = blocks.find((b) => b.kind === "p");
  const page: ReferencePage = {
    id,
    title,
    label: id === "index" ? "Contents" : title,
    lead: lead?.kind === "p" ? plain(lead.text) : "",
    blocks,
    anchors,
  };
  return { page, links };
}

/**
 * The manual, from its files' names and Markdown: the index, then the pages it
 * links to, every link checked.
 */
export function readManual(files: Map<string, string>): ReferencePage[] {
  if (!files.has("index.md")) throw new Error(`content/reference has no index.md. Run npm run docs:update.`);
  const parsed = new Map([...files].map(([f, markdown]) => [f.replace(/\.md$/, ""), parsePage(f, markdown)]));

  // the order the index first links to each page in: its Contents table
  const index = parsed.get("index")!;
  const order = ["index", ...new Set(index.links.flatMap((l) => l.href.match(/^ref:([\w-]+)/)?.[1] ?? []))];
  const unlisted = [...parsed.keys()].filter((id) => !order.includes(id));
  if (unlisted.length) throw new Error(`content/reference: the index doesn't link to ${unlisted.join(", ")}`);

  // every link leads to a page there is, and a section that page has
  for (const [id, { links }] of parsed) {
    for (const { href, n } of links) {
      const m = href.match(/^(?:ref:([\w-]+))?(?:#([\w-]+))?$/);
      if (!m || href.startsWith("tutorial:") || /^https:/.test(href)) continue;
      const to = parsed.get(m[1] ?? id)?.page;
      if (!to) throw new ManualError(`a link to a page there isn't: ${href}`, `${id}.md`, n, fixLink(`${id}.md`));
      if (m[2] && !to.anchors.has(m[2])) {
        throw new ManualError(`a link to a section ${to.id}.md doesn't have: ${href}`, `${id}.md`, n, fixLink(`${id}.md`));
      }
    }
  }
  return order.map((id) => {
    const page = parsed.get(id)?.page;
    if (!page) throw new Error(`content/reference: the index links to ${id}.md, which isn't there. Run npm run docs:update.`);
    return page;
  });
}

/** The manual, read once at startup. */
export const REFERENCE: ReferencePage[] = readManual(
  new Map(fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")])),
);

/** The manual's own title, its index's # heading: "HaiKIT reference manual". */
export const REFERENCE_TITLE = REFERENCE[0]!.title;

export const referencePageOf = (id: string) => REFERENCE.find((p) => p.id === id) ?? null;

/** Each page's id and how it's named, in order. */
export const referenceRefs = (): ReferenceRef[] => REFERENCE.map(({ id, label }) => ({ id, title: label }));
