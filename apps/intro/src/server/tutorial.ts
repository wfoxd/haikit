/**
 * HaiKIT's tutorials, built into this app.
 *
 * content/tutorial.md and content/tutorial-2.md are copies of docs/tutorial.md
 * and docs/tutorial-2.md from the haikit repository; `npm run tutorial:update`
 * refreshes them. Each is parsed here once, when the server starts, into the
 * pages the browser shows: its introduction, its steps, and where to go next.
 * The second tutorial's page ids carry a `2-` prefix ("2-intro", "2-01"), so
 * every page has an id of its own.
 *
 * The parser knows the Markdown the tutorial actually uses: headings,
 * paragraphs, lists, tables, fenced code under a **`file`** — *action* label,
 * code lines numbered `// 1` with their **1** notes after, > [!NOTE] callouts,
 * and one <details> fold. Anything else stops the server with the line it
 * couldn't place, so a change upstream fails `npm test` rather than showing a
 * garbled page.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Block } from "../shared/surfaces.ts";

type Prose = { kind: "p"; text: string } | { kind: "list"; items: string[] };
type CodeBlock = Extract<Block, { kind: "code" }>;

export interface TutorialPage {
  /** "intro", "01" … "10", or "next-steps"; in the second tutorial, "2-intro", "2-01" … */
  id: string;
  /** "Introduction", "Step 01", "Where to go next". */
  label: string;
  title: string;
  /** Its first paragraph, for the model's digest. */
  lead: string;
  /** The files it has you create or change. */
  files: string[];
  blocks: Block[];
}

export interface Tutorial {
  /** 1 or 2. */
  n: number;
  title: string;
  lead: string;
  pages: TutorialPage[];
}

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../content");

/** The tutorials, in reading order: each one's file, and the prefix its page ids carry. */
const SOURCES = [
  { n: 1, file: "tutorial.md", prefix: "" },
  { n: 2, file: "tutorial-2.md", prefix: "2-" },
];

const FENCE = /^(\s*)```(\w*)\s*$/;
const FILE = /^\*\*`([^`]+)`\*\* — \*(.+)\*\s*$/;
const NOTE = /^\*\*(\d+)\*\*\s+(.*)$/;
const MARK = /^(.*?)\s+\/\/ (\d+)\s*$/;
const CALLOUT = /^> \[!(NOTE|TIP|WARNING)\]\s*$/;
const ITEM = /^(\s*)- (.*)$/;
const LANGS = ["ts", "tsx", "js", "json", "css", "html", "bash", "text"] as const;

class TutorialError extends Error {
  constructor(what: string, line: number, file = reading) {
    super(`content/${file}, line ${line}: ${what}. Update src/server/tutorial.ts to read it.`);
  }
}

/** The file being parsed, for the errors that name it. */
let reading = "tutorial.md";

/** A code block, its `// n` marks lifted off the lines they number. */
function codeBlock(lang: string, body: string[], file: { file: string; action: string } | null): CodeBlock {
  const marks: { line: number; n: number }[] = [];
  const numbered = lang === "ts" || lang === "tsx" || lang === "js";
  const lines = body.map((text, line) => {
    const m = numbered ? text.match(MARK) : null;
    if (!m) return text;
    marks.push({ line, n: Number(m[2]) });
    return m[1]!.replace(/\s+$/, "");
  });
  return {
    kind: "code",
    lang: (LANGS as readonly string[]).includes(lang) ? (lang as CodeBlock["lang"]) : "text",
    code: lines.join("\n"),
    ...(file ? { file: file.file, action: file.action } : {}),
    ...(marks.length ? { marks } : {}),
  };
}

/** Paragraphs and lists, from lines that may carry a "> " prefix already stripped. */
function prose(lines: string[]): Prose[] {
  const out: Prose[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    if (list) out.push({ kind: "list", items: list });
    para = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const item = raw.match(ITEM);
    if (item) {
      if (para.length) flush();
      (list ??= []).push(item[2]!.trim());
    } else if (list) {
      list[list.length - 1] += ` ${line}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

/** The blocks of one page, from the lines under its ## heading. */
function parseBlocks(lines: string[], first: number): Block[] {
  const blocks: Block[] = [];
  let file: { file: string; action: string } | null = null;
  // the last code block with numbered lines, which **n** notes belong to
  let marked: CodeBlock | null = null;
  // the note being read, which paragraphs and lists after it join
  let note: { n: number; body: Prose[] } | null = null;
  let i = 0;

  const at = () => first + i;
  const startsBlock = (line: string) =>
    FENCE.test(line) || FILE.test(line) || CALLOUT.test(line) || line.startsWith("#") ||
    line.startsWith("|") || line.startsWith("<") || NOTE.test(line) || ITEM.test(line);
  const lastMark = () => Math.max(0, ...(marked?.marks ?? []).map((m) => m.n));

  /** Prose belongs to the open note, unless it's past the last note's own text. */
  const place = (items: Prose[], aside: boolean) => {
    if (note && (aside || note.n < lastMark() || note.body.length === 0)) note.body.push(...items);
    else {
      note = null;
      for (const item of items) blocks.push(item);
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const indent = fence[1]!.length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!.slice(indent));
      if (i >= lines.length) throw new TutorialError("a code fence that never closes", at());
      i++;
      const block = codeBlock(fence[2] ?? "", body, file);
      if (block.marks) marked = block;
      blocks.push(block);
      file = null;
      note = null;
      continue;
    }

    const label = line.match(FILE);
    if (label) {
      file = { file: label[1]!, action: label[2]! };
      note = null;
      i++;
      continue;
    }

    const callout = line.match(CALLOUT);
    if (callout) {
      i++;
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) inner.push(lines[i++]!.replace(/^> ?/, ""));
      const body = prose(inner);
      const head = body[0];
      const title = head?.kind === "p" ? head.text.match(/^\*\*(.+)\*\*$/)?.[1] : undefined;
      if (title) body.shift();
      const tone = ({ NOTE: "note", TIP: "tip", WARNING: "warning" } as const)[callout[1] as "NOTE" | "TIP" | "WARNING"];
      blocks.push({ kind: "callout", tone, ...(title ? { title } : {}), body });
      note = null;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ kind: "h", text: line.slice(4).trim() });
      note = null;
      i++;
      continue;
    }

    if (line.startsWith("<details>")) {
      const rest = [line, lines[i + 1] ?? ""].join(" ");
      const summary = rest.match(/<summary>(.*?)<\/summary>/)?.[1]?.trim();
      if (!summary) throw new TutorialError("a <details> without a <summary>", at());
      blocks.push({ kind: "details", summary });
      note = null;
      i += line.includes("<summary>") ? 1 : 2;
      continue;
    }
    if (line.startsWith("</details>")) {
      blocks.push({ kind: "details-end" });
      note = null;
      i++;
      continue;
    }
    if (line.startsWith("<")) throw new TutorialError(`HTML it doesn't know: ${line.slice(0, 40)}`, at());

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i++]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
      }
      blocks.push({ kind: "table", head: rows[0] ?? [], rows: rows.slice(1) });
      note = null;
      continue;
    }

    const numbered = line.match(NOTE);
    if (numbered) {
      if (!marked) throw new TutorialError("a numbered note with no numbered code before it", at());
      const opened = { n: Number(numbered[1]), body: [] as Prose[] };
      (marked.notes ??= []).push(opened);
      note = opened;
      const text = [numbered[2]!];
      i++;
      while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) text.push(lines[i++]!.trim());
      opened.body.push({ kind: "p", text: text.join(" ") });
      continue;
    }

    if (ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!)) {
        const item = lines[i]!.match(ITEM);
        if (item) items.push(item[2]!.trim());
        else if (startsBlock(lines[i]!)) break;
        else items[items.length - 1] += ` ${lines[i]!.trim()}`;
        i++;
      }
      // a list indented under a note is part of it
      place([{ kind: "list", items }], /^\s+- /.test(line));
      continue;
    }

    // a paragraph: this line and the ones after it, up to a blank or a block
    const text = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) text.push(lines[i++]!.trim());
    const joined = text.join(" ");
    place([{ kind: "p", text: joined }], joined.startsWith("↳"));
  }
  return blocks;
}

export function parseTutorial(markdown: string, { n = 1, prefix = "" } = {}): Tutorial {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = lines[0]?.match(/^# (.+)$/)?.[1];
  if (!title) throw new TutorialError("no # title on the first line", 1);

  let i = 1;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const lead: string[] = [];
  while (i < lines.length && lines[i]!.startsWith("> ")) lead.push(lines[i++]!.slice(2).trim());

  // split at ## headings, outside code fences
  const sections: { heading: string; line: number; lines: string[] }[] = [];
  let fenced = false;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line) || /^\s*```\s*$/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) sections.push({ heading: line.slice(3).trim(), line: i + 2, lines: [] });
    else sections.at(-1)?.lines.push(line);
  }

  const pages = sections.map((section, at): TutorialPage => {
    const step = section.heading.match(/^(\d{2}) · (.+)$/);
    const meta = step
      ? { id: step[1]!, label: `Step ${step[1]}`, title: step[2]! }
      : at === 0
        ? { id: "intro", label: "Introduction", title: section.heading }
        : /^where to go next$/i.test(section.heading)
          ? { id: "next-steps", label: "After the tutorial", title: section.heading }
          : { id: section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: section.heading, title: section.heading };
    meta.id = prefix + meta.id;
    const blocks = parseBlocks(section.lines, section.line);
    const lead = blocks.find((b) => b.kind === "p")?.text ?? "";
    const files = [
      ...new Set(
        blocks.flatMap((b) => (b.kind === "code" && b.file && !/^(terminal|tool_result)$/.test(b.file) ? [b.file] : [])),
      ),
    ];
    return { ...meta, lead, files, blocks };
  });

  return { n, title, lead: lead.join(" "), pages };
}

/** The tutorials, read once at startup. */
export const TUTORIALS: Tutorial[] = SOURCES.map(({ n, file, prefix }) => {
  reading = file;
  return parseTutorial(fs.readFileSync(path.join(CONTENT, file), "utf8"), { n, prefix });
});

/** The first tutorial, which the welcome screen opens on. */
export const TUTORIAL = TUTORIALS[0]!;

export const tutorialPage = (id: string) => TUTORIALS.flatMap((t) => t.pages).find((p) => p.id === id) ?? null;

/** Which tutorial a page belongs to. */
export const tutorialOf = (id: string) => TUTORIALS.find((t) => t.pages.some((p) => p.id === id)) ?? null;

/** Each page's id, label and title, in order: one tutorial's, or every page of both, read on from one to the next. */
export const tutorialRefs = (n?: number) =>
  TUTORIALS.filter((t) => n === undefined || t.n === n)
    .flatMap((t) => t.pages)
    .map(({ id, label, title }) => ({ id, label, title }));

/** A tutorial's numbered steps, as the welcome screen and the menu list them. */
export const tutorialSteps = (n: number) => tutorialRefs(n).filter((page) => /^(\d+-)?\d+$/.test(page.id));
