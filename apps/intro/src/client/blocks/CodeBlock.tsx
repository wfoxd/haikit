import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import type { Block } from "../../shared/surfaces.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { highlight, highlightLines, TONES, type Run } from "@/lib/highlight";
import { toClipboard } from "@/lib/clipboard";
import { reveal } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Inline } from "./inline.tsx";
import { Prose } from "./Prose.tsx";

type Code = Extract<Block, { kind: "code" }>;

let figures = 0;

const runs = (list: Run[]) =>
  list.map((run, i) =>
    run.tone ? (
      <span key={i} className={TONES[run.tone]}>
        {run.text}
      </span>
    ) : (
      run.text
    ),
  );

/** A note's number: on its line, a link to the note; by the note, a link back. */
function Mark({ n, to, label, className }: { n: number; to: string; label: string; className?: string }) {
  return (
    <a
      href={`#${to}`}
      aria-label={label}
      className={cn(
        "inline-flex h-[1.55em] min-w-[1.55em] items-center justify-center bg-primary px-[0.3em] align-[0.05em] font-sans text-[10.5px] leading-none font-bold text-primary-foreground no-underline",
        className,
      )}
      onClick={(e) => {
        e.preventDefault();
        reveal(to);
      }}
    >
      {n}
    </a>
  );
}

/**
 * A button that copies a block's code as written: the note numbers drawn on
 * its lines aren't part of `code`, so they never reach the clipboard.
 */
function CopyButton({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = async () => {
    setCopied(await toClipboard(code));
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopied(null), 2000);
  };
  return (
    <Button
      variant="outline"
      size="xs"
      title="Copy the code"
      className={cn("text-muted-foreground", copied && "text-hai-good", className)}
      onClick={copy}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {/* a live region, so a screen reader hears "Copied" too */}
      <span aria-live="polite">{copied === null ? "Copy" : copied ? "Copied" : "Couldn't copy"}</span>
    </Button>
  );
}

const BAR = "flex flex-wrap items-center font-sans gap-x-2.5 gap-y-1 border-b border-hai-line-soft bg-hai-panel-2 px-3 py-[7px]";
const PRE = "m-0 max-h-[32em] overflow-auto px-4 py-3.5 font-mono text-[13px]/[1.55] [tab-size:2]";

/**
 * Code, with the file it goes in or where it was read from, a copy button,
 * and numbered notes on its lines when it has them: each number links to its
 * note, and each note links back.
 */
export function CodeBlock({ block }: { block: Code }) {
  const [uid] = useState(() => `code-${++figures}`);
  const marks = new Map((block.marks ?? []).map((m) => [m.line, m.n]));

  let code: ReactNode;
  if (marks.size) {
    const lines = highlightLines(block.code, block.lang);
    code = lines.map((line, i) => {
      const n = marks.get(i);
      return (
        <span key={i}>
          <span id={n == null ? undefined : `${uid}-line-${n}`} tabIndex={n == null ? undefined : -1} className="outline-none">
            {runs(line)}
            {/* a number on a line of code is a link, not code: selecting the code leaves it out */}
            {n != null && <Mark n={n} to={`${uid}-${n}`} label={`Note ${n}`} className="ml-3 select-none" />}
          </span>
          {i < lines.length - 1 && "\n"}
        </span>
      );
    });
  } else {
    code = runs(highlight(block.code, block.lang));
  }

  // the bars above the code: where it was read from, the file it goes in
  const bars: { key: string; className: string; content: ReactNode }[] = [];
  if (block.source)
    bars.push({
      key: "source",
      className: "font-mono text-xs text-muted-foreground",
      content: (
        <>
          <Tooltip>
            <TooltipTrigger className="inline-flex items-center gap-1.5 font-semibold text-hai-good before:size-[7px] before:rounded-full before:bg-current">
              Live source
            </TooltipTrigger>
            <TooltipContent>Read from the code this server is running, when it started</TooltipContent>
          </Tooltip>
          <span className="[overflow-wrap:anywhere]">{block.source}</span>
        </>
      ),
    });
  if (block.file)
    bars.push({
      key: "file",
      className: "text-[12.5px]",
      content: (
        <>
          <span className="font-mono font-semibold [overflow-wrap:anywhere]">{block.file}</span>
          {block.action && (
            <Badge variant="secondary" className="bg-hai-accent-soft text-hai-accent">
              <Inline text={block.action} />
            </Badge>
          )}
        </>
      ),
    });
  const pre = (
    <pre className={PRE}>
      <code>{code}</code>
    </pre>
  );

  // a figure's caption is its first child or its last, so with notes after it it's a paragraph
  const Caption = block.notes?.length ? "p" : "figcaption";

  // The copy button goes at the end of the last bar, or beside the code when
  // there's none: never over the code, where it would hide a long line.
  return (
    <figure className="my-[18px]">
      <div className="border border-hai-line-soft bg-hai-code-bg">
        {bars.map((bar, i) => (
          <div key={bar.key} className={cn(BAR, bar.className)}>
            {bar.content}
            {i === bars.length - 1 && <CopyButton code={block.code} className="ml-auto" />}
          </div>
        ))}
        {bars.length ? (
          pre
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start">
            {pre}
            <CopyButton code={block.code} className="mt-2.5 mr-2.5" />
          </div>
        )}
      </div>
      {block.caption && (
        <Caption className="mt-[7px] font-sans text-sm/normal text-muted-foreground">
          <Inline text={block.caption} />
        </Caption>
      )}
      {block.notes?.length ? (
        <ol className="mt-3 grid list-none gap-2.5 p-0">
          {block.notes.map((note) => (
            <li key={note.n} id={`${uid}-${note.n}`} tabIndex={-1} className="grid grid-cols-[2.2em_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 outline-none">
              <Mark n={note.n} to={`${uid}-line-${note.n}`} label={`Show the line for note ${note.n}`} className="mt-1" />
              <div className="font-sans text-[15px]/[1.55] [&_li]:mb-1 [&_p]:mb-1.5 [&_ul]:mt-1 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-[1.1em]">
                {note.body.map((part, i) => (
                  <Prose key={i} part={part} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  );
}
