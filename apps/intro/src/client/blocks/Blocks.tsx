/**
 * The pieces of a lesson, a tutorial step or a reference page, drawn in
 * order. See `Block` in ../../shared/surfaces.ts for the kinds there are.
 */

import type { ReactNode } from "react";
import type { Block } from "../../shared/surfaces.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock.tsx";
import { inline, type Linker } from "./inline.tsx";
import { Picker } from "./Picker.tsx";
import { Prose } from "./Prose.tsx";
import { Sequence } from "./Sequence.tsx";

type Drawn = Exclude<Block, { kind: "details" | "details-end" }>;

const P = "mb-3.5 max-w-[66ch]";
const LIST = "mb-4 max-w-[66ch] pl-[1.2em] marker:text-hai-dim [&>li]:mb-2";

/** An aside's colours: look in the accent, tip in good, warn in warn. */
const ASIDES = {
  look: ["border-l-hai-accent bg-hai-accent-soft", "text-hai-accent"],
  tip: ["border-l-hai-good bg-hai-good-soft", "text-hai-good"],
  warn: ["border-l-hai-warn bg-hai-warn-soft", "text-hai-warn"],
} as const;

/** A note or a callout: its label, then its words. */
function Aside({ tone, label, children }: { tone: keyof typeof ASIDES; label: string; children: ReactNode }) {
  const [box, title] = ASIDES[tone];
  return (
    <Alert role="note" className={cn("my-[18px] block max-w-[66ch] border-0 border-l-3 px-4 py-3 font-sans text-[15px]/[1.55]", box)}>
      <AlertTitle className={cn("text-[13.5px] font-bold", title)}>{label}</AlertTitle>
      <AlertDescription className="mt-0.5 text-[15px]/[1.55] text-pretty text-foreground [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-[1.1em]">
        {children}
      </AlertDescription>
    </Alert>
  );
}

const NOTES = { look: "Look", tip: "Try it", warn: "Before you ship" };
const CALLOUTS = { note: ["look", "Note"], tip: ["tip", "Tip"], warning: ["warn", "Warning"] } as const;

function draw(block: Drawn, key: number, link?: Linker): ReactNode {
  switch (block.kind) {
    case "p":
      return (
        <p key={key} className={P}>
          {inline(block.text, link)}
        </p>
      );
    case "h": {
      // a reference page's ## is an h3 under the page's h2, its ### an h4
      const Tag = block.level === 4 ? "h5" : block.level === 3 ? "h4" : "h3";
      return (
        <Tag
          key={key}
          data-anchor={block.id}
          // a link to it moves the focus there
          tabIndex={block.id ? -1 : undefined}
          className={cn(
            "mt-7 mb-2 scroll-mt-3.5 outline-none font-heading text-xl leading-[1.3] font-semibold tracking-[-0.01em]",
            block.level === 2 && "mt-9 text-[23px]",
            block.level === 3 && "text-[19px]",
            block.level === 4 && "mt-[22px] text-[16.5px]",
          )}
        >
          {inline(block.text, link)}
        </Tag>
      );
    }
    case "list":
      return (
        <ul key={key} className={cn(LIST, "list-disc")}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item, link)}</li>
          ))}
        </ul>
      );
    case "items": {
      // a reference page's list: an item that is one paragraph is its text;
      // anything more is its blocks
      const List = block.ordered ? "ol" : "ul";
      return (
        <List
          key={key}
          start={block.ordered ? block.start : undefined}
          className={cn(
            LIST,
            block.ordered ? "list-decimal" : "list-disc",
            "[&_ol]:mt-2 [&_ul]:mt-2 [&>li>:first-child]:mt-0 [&>li>:last-child]:mb-0",
          )}
        >
          {block.items.map((item, i) => {
            const [only] = item;
            return <li key={i}>{item.length === 1 && only?.kind === "p" ? inline(only.text, link) : blocks(item, link)}</li>;
          })}
        </List>
      );
    }
    case "note":
      return (
        <Aside key={key} tone={block.tone} label={NOTES[block.tone]}>
          <p>{inline(block.text, link)}</p>
        </Aside>
      );
    case "callout": {
      const [tone, label] = CALLOUTS[block.tone];
      return (
        <Aside key={key} tone={tone} label={label}>
          {block.title && <p className="font-bold">{inline(block.title, link)}</p>}
          {block.body.map((part, i) => (
            <Prose key={i} part={part} link={link} />
          ))}
        </Aside>
      );
    }
    case "code":
      return <CodeBlock key={key} block={block} />;
    case "diagram":
      return (
        <figure key={key} className="my-[18px]">
          <pre className="m-0 max-h-[32em] overflow-auto border border-hai-line-soft bg-hai-code-bg px-4 py-3.5 font-mono text-[13px]/[1.55]">
            {block.text}
          </pre>
          {block.caption && <figcaption className="mt-[7px] font-sans text-sm/normal text-muted-foreground">{block.caption}</figcaption>}
        </figure>
      );
    case "table":
      return (
        <div key={key} className="mt-4 mb-5">
          <Table className="font-sans text-[14.5px]/[1.5]">
            <TableHeader>
              <TableRow className="border-b-2 border-hai-line hover:bg-transparent">
                {block.head.map((cell, i) => (
                  <TableHead key={i} className="h-auto py-2 pr-3 pl-0 font-semibold">
                    {inline(cell, link)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, i) => (
                <TableRow key={i} className="border-hai-line-soft hover:bg-transparent">
                  {row.map((cell, j) => (
                    <TableCell key={j} className="py-[9px] pr-3 pl-0 align-top whitespace-normal first:whitespace-nowrap">
                      {inline(cell, link)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    case "compare":
      return (
        <div key={key} className="mt-[18px] mb-[22px] grid grid-cols-2 gap-3.5 font-sans max-sm:grid-cols-1">
          {block.sides.map((side, i) => (
            <section
              key={i}
              className={cn(
                "border border-t-3 border-hai-line-soft bg-secondary px-3.5 py-3",
                side.tone === "good" ? "border-t-hai-good" : "border-t-hai-bad",
              )}
            >
              <h4 className={cn("mb-2 font-heading text-[15px] font-semibold", side.tone === "good" ? "text-hai-good" : "text-hai-bad")}>
                {side.title}
              </h4>
              {side.picker ? (
                <Picker picker={side.picker} />
              ) : side.sample ? (
                <pre className="m-0 font-mono text-xs/normal whitespace-pre-wrap">{side.sample}</pre>
              ) : null}
              <p className="mt-2.5 text-[14.5px]/[1.55]">{inline(side.text)}</p>
            </section>
          ))}
        </div>
      );
    case "sequence":
      return <Sequence key={key} block={block} />;
  }
}

/**
 * Blocks as elements, in order. A details block folds the ones after it, up
 * to its details-end, under its summary.
 * @param link what the links in their text become
 */
export function blocks(list: Block[], link?: Linker): ReactNode[] {
  const top: ReactNode[] = [];
  const folds: { key: number; summary: string; items: ReactNode[] }[] = [];
  const into = () => folds.at(-1)?.items ?? top;
  const close = () => {
    const fold = folds.pop();
    if (!fold) return;
    into().push(
      // a fold is the browser's own: what's inside is on the page, for the
      // browser's find and for a link to a section in it
      <details key={fold.key} className="group my-[18px] border border-hai-line bg-secondary px-4 [&>:last-child]:mb-4">
        <summary className="cursor-pointer py-3 font-sans text-[15px] font-semibold group-open:mb-3 group-open:border-b group-open:border-hai-line-soft">
          {inline(fold.summary)}
        </summary>
        {fold.items}
      </details>,
    );
  };
  list.forEach((block, i) => {
    if (block.kind === "details") folds.push({ key: i, summary: block.summary, items: [] });
    else if (block.kind === "details-end") close();
    else into().push(draw(block, i, link));
  });
  while (folds.length) close();
  return top;
}

/** {@link blocks} as a component. */
export function Blocks({ blocks: list, link }: { blocks: Block[]; link?: Linker }) {
  return <>{blocks(list, link)}</>;
}
