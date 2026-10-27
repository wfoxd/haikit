import { useRef, type ReactNode } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { CourseMapProps, courseMap } from "../../shared/surfaces.ts";
import { scrollTranscript } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { inline } from "../blocks/inline.tsx";
import { Closed, useShowTop } from "./parts.tsx";

/** A map stored at version 2 had one tutorial, under `tutorial`, with no blurb. */
type Stored = Omit<CourseMapProps, "tutorials"> & {
  tutorials?: CourseMapProps["tutorials"];
  tutorial?: Omit<CourseMapProps["tutorials"][number], "blurb">;
};

/** A part of the course, or a tutorial: its heading, its blurb, its rows. */
function Part({ n, title, blurb, children }: { n: string; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="mt-[18px]">
      <h3 className="flex items-baseline gap-2.5 font-heading text-[17px]/[1.3] font-semibold">
        <span className="font-bold whitespace-nowrap text-primary">{n}</span>
        <span>{title}</span>
      </h3>
      <p className="mt-1 mb-2 max-w-[64ch] font-serif text-[15px]/[1.5] text-muted-foreground">{blurb}</p>
      <ol className="list-none border-t border-hai-line-soft">{children}</ol>
    </section>
  );
}

/**
 * Every lesson and tutorial page, in rows: while the map waits, a row is a
 * button that opens it, through the declared `open` action.
 */
export function CourseMap({ props, send, mode, state, selection }: SurfaceProps<typeof courseMap>) {
  const root = useRef<HTMLDivElement>(null);
  const live = state === "live" && mode === "elicit";
  // longer than the window, it would open on its glossary: show its top
  useShowTop(root, state);
  const lessons = props.parts.flatMap((p) => p.lessons);
  const minutes = lessons.reduce((n, l) => n + l.minutes, 0);

  // A version 1 map has no tutorial, and a version 2 map has the first only.
  const stored = props as Stored;
  const tutorials =
    stored.tutorials ??
    (stored.tutorial ? [{ blurb: "Build a Hello, World! app with HaiKIT, step by step, read right here.", ...stored.tutorial }] : []);

  const open = (id: string) => {
    // the map opened at its top, so the transcript holds there: follow again,
    // so what it opens streams into view
    scrollTranscript(root.current?.parentElement, "bottom");
    void send("open", id);
  };

  const row = (id: string, children: ReactNode) => {
    const className = cn(
      "grid w-full grid-cols-[2.6em_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-hai-line-soft px-2.5 py-[9px] text-left",
      live && "cursor-pointer hover:bg-hai-hover",
      id === selection && "bg-hai-selected shadow-[inset_3px_0_0_var(--hai-accent)]",
    );
    return (
      <li key={id}>
        {live ? (
          <button type="button" className={className} onClick={() => open(id)}>
            {children}
          </button>
        ) : (
          <div className={className}>{children}</div>
        )}
      </li>
    );
  };
  const n = "font-mono text-[13px]/[1.6] font-semibold text-primary tabular-nums";

  return (
    <div ref={root} className="max-w-[1200px] px-5 pt-[18px] pb-4 font-sans max-sm:px-3.5 max-sm:pt-3.5 max-sm:pb-3">
      <header className="mb-1.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h2 className="font-heading text-2xl/[1.2] font-bold tracking-[-0.015em]">Course map</h2>
        <p className="text-[13px] text-muted-foreground">
          {props.parts.length} parts, {lessons.length} lessons, about {minutes} minutes
        </p>
      </header>

      {props.parts.map((part) => (
        <Part key={part.n} n={`Part ${part.n}`} title={part.title} blurb={part.blurb}>
          {part.lessons.map((l) =>
            row(
              l.id,
              <>
                <span className={n}>{l.id}</span>
                <span className="text-[15px] font-semibold">{l.title}</span>
                <span className="text-[12.5px] whitespace-nowrap text-muted-foreground">{l.minutes} min</span>
                <span className="col-[2/-1] text-[13.5px]/[1.45] text-muted-foreground">{l.summary}</span>
              </>,
            ),
          )}
        </Part>
      ))}

      {/* The tutorials' pages, in the same rows: opening one is the same `open` action. */}
      {tutorials.map((tutorial, i) => (
        <Part key={i} n={tutorials.length > 1 ? `Tutorial ${i + 1}` : "Tutorial"} title={tutorial.title} blurb={tutorial.blurb}>
          {tutorial.pages.map((page) =>
            row(
              page.id,
              <>
                {/* the step's number, without a later tutorial's prefix */}
                <span className={n}>{page.id.match(/^(?:\d+-)?(\d+)$/)?.[1] ?? ""}</span>
                <span className="text-[15px] font-semibold">{page.title}</span>
              </>,
            ),
          )}
        </Part>
      ))}

      {/* Opening this is local: the contract declares no action for it. */}
      <details className="mt-[18px] border border-hai-line-soft px-3.5">
        <summary className="cursor-pointer py-2.5 text-sm font-semibold">Glossary, {props.glossary.length} terms</summary>
        <dl className="mb-3.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 max-sm:grid-cols-1 max-sm:gap-y-0.5 max-sm:[&>dd]:mb-2">
          {props.glossary.map((t, i) => [
            <dt key={`t${i}`} className="font-mono text-[13px]/[1.5] font-semibold text-hai-good">
              {t.term}
            </dt>,
            <dd key={`d${i}`} className="text-sm/[1.5]">
              {inline(`${t.definition} Lesson ${t.lesson}.`)}
            </dd>,
          ])}
        </dl>
      </details>

      {!live && state === "frozen" && (
        <Closed>
          {typeof selection !== "string"
            ? "Closed when you typed instead of picking."
            : `You opened ${
                /\./.test(selection)
                  ? `lesson ${selection}`
                  : /^(\d+-)?(intro|next-steps)$/.test(selection)
                    ? "a page of a tutorial"
                    : `step ${selection} of a tutorial`
              }.`}
        </Closed>
      )}
    </div>
  );
}
