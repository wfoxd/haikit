/**
 * The welcome's story, a section at a time: software today, a chatbot beside
 * an app against an app the AI runs, how the AI does a job with you, how
 * HaiKIT saves tokens, and what you get. Each section is a container, so its
 * grids answer to its own width.
 */

import type { ReactNode } from "react";
import type { WelcomeProps } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Inline } from "../blocks/inline.tsx";
import { Architecture } from "../drawings/Architecture.tsx";
import { Illustration } from "../drawings/Illustrations.tsx";
import { Mini } from "../drawings/Minis.tsx";

type Head = { label: string; title: string; lead: string };
type Point = { title: string; text: string };
type Scene = WelcomeProps["example"]["steps"][number]["scene"];

/** A small-caps label over a panel or a section. */
export const KICKER = "font-heading text-[13px] font-semibold tracking-[0.06em] uppercase";
/** A panel on the page. */
export const PANEL = "border border-hai-line-soft bg-secondary";

/** A section of the story, under a rule, with its number, label, title and lead. */
export function Section({ n, head, children }: { n: number; head: Head; children: ReactNode }) {
  return (
    <section className="@container mt-12 border-t border-hai-line-soft pt-10 max-sm:mt-9 max-sm:pt-[30px]">
      <header className="mb-[26px]">
        <p className={cn(KICKER, "mb-2.5 flex items-center gap-2.5 text-hai-accent")}>
          <span className="bg-hai-accent-soft px-2 py-0.5 font-mono text-xs tracking-normal tabular-nums">{String(n).padStart(2, "0")}</span>
          <span>{head.label}</span>
        </p>
        <h3 className="max-w-[36ch] font-heading text-[clamp(22px,3cqi,30px)]/[1.2] font-semibold tracking-[-0.02em] text-balance">
          {head.title}
        </h3>
        <p className="mt-2 max-w-[62ch] font-serif text-[17px]/[1.55] text-pretty text-muted-foreground">
          <Inline text={head.lead} />
        </p>
      </header>
      {children}
    </section>
  );
}

/** Titled points: a short heading, then a sentence or two, each after its marker. */
function Points({ points, marker, className }: { points: Point[]; marker: ReactNode; className?: string }) {
  return (
    <ul className={cn("grid list-none gap-3.5", className)}>
      {points.map((point, i) => (
        <li key={i} className="relative">
          {marker}
          <h5 className="mb-[3px] font-heading text-[15.5px]/[1.35] font-semibold">{point.title}</h5>
          <p className="font-sans text-[14.5px]/[1.5] text-muted-foreground">
            <Inline text={point.text} />
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Software as people drive it today, beside software the AI drives. */
export function Today({ today, n }: { today: WelcomeProps["today"]; n: number }) {
  // today in the warn colour, a person doing the work; HaiKIT in the accent, the model's
  return (
    <Section n={n} head={today}>
      <div className="grid gap-4 @min-[760px]:grid-cols-2 @min-[760px]:gap-5">
        {[today.before, today.after].map((side, i) => {
          const after = i === 1;
          return (
            <article
              key={i}
              className={cn(
                PANEL,
                "flex flex-col px-6 py-[22px] max-sm:px-4",
                after && "border-hai-accent/40 bg-[linear-gradient(var(--hai-accent-soft),transparent_55%)]",
              )}
            >
              <p className={cn(KICKER, after ? "text-hai-accent" : "text-hai-warn")}>{side.label}</p>
              <h4 className="mt-1 mb-4 font-heading text-xl/[1.25] font-semibold tracking-[-0.01em]">{side.title}</h4>
              <Illustration image={side.image} className="mb-[18px]" svgClassName="mx-auto max-w-[440px]" />
              <Points
                points={side.points}
                className="[&>li]:pl-5"
                marker={<span aria-hidden className={cn("absolute top-[0.42em] left-0 size-2 rounded-full", after ? "bg-hai-accent" : "bg-hai-warn")} />}
              />
            </article>
          );
        })}
      </div>
    </Section>
  );
}

/** Who says each line of a scene, for a screen reader: sighted readers tell by its look. */
const SPEAKERS = { world: "News:", you: "You type:", ai: "The AI says:", option: "Option:", click: "You click:" };
const LINES = {
  world: "self-start bg-hai-warn/14 px-2.5 py-[3px] text-xs font-semibold text-hai-warn",
  you: "self-end bg-hai-user-bg px-[11px] py-1.5",
  ai: "self-start border-l-3 border-hai-accent bg-secondary px-[11px] py-1.5",
  option: "self-start border border-hai-line bg-secondary px-2.5 py-[5px]",
  click: "self-start border-[1.5px] border-hai-good bg-hai-good-soft px-2.5 py-[5px] font-semibold",
};

/**
 * A scene, as the person would see it: a line from the world, what they
 * typed, what the AI said, what they clicked, or one of the demo's components
 * on screen. A picture of the demo, not a control: nothing in it can be
 * clicked. Its lines say more than the step's words, so a screen reader reads
 * them too, each after its speaker.
 */
function SceneOf({ scene, className }: { scene: Scene; className?: string }) {
  return (
    <div role="group" aria-label="What you'd see" className={cn("flex min-h-28 flex-col justify-center gap-[7px] border border-hai-line-soft bg-card p-3", className)}>
      {scene.map((line, i) =>
        "ui" in line ? (
          <Mini key={i} c={line} />
        ) : (
          <p key={i} className={cn("max-w-[92%] font-sans text-[13px]/[1.4]", LINES[line.from])}>
            <span className="sr-only">{SPEAKERS[line.from]} </span>
            {line.from === "click" && (
              <span aria-hidden className="text-hai-good">
                ✓{" "}
              </span>
            )}
            {line.text}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * A chatbot added beside an app's screens against an app the AI runs: each
 * side's name over the same request as it plays there, then a row for each
 * difference. Wide, a table of three columns, the HaiKIT column edged in the
 * accent; narrower, the topic over the two cells, each cell naming its side.
 */
export function Versus({ versus, n }: { versus: WelcomeProps["versus"]; n: number }) {
  const sides = ["chatbot", "haikit"] as const;
  return (
    <Section n={n} head={versus}>
      <div className="grid grid-cols-1 gap-2.5 @min-[560px]:grid-cols-2 @min-[860px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)_minmax(0,1fr)] @min-[860px]:gap-0">
        <div className="hidden @min-[860px]:block" />
        {sides.map((which) => (
          <div
            key={which}
            className={cn(
              PANEL,
              "flex flex-col p-4 @min-[860px]:px-5 @min-[860px]:pt-[18px] @min-[860px]:pb-5",
              which === "haikit"
                ? "border-hai-accent/40 bg-[linear-gradient(var(--hai-accent-soft),var(--hai-accent-soft))] @min-[860px]:border-b-0"
                : "@min-[860px]:mr-2.5 @min-[860px]:border-0",
            )}
          >
            <h4 className={cn(KICKER, "mb-3", which === "haikit" ? "text-hai-accent" : "text-muted-foreground")}>{versus[which].name}</h4>
            <SceneOf scene={versus[which].scene} className="flex-1 justify-start" />
          </div>
        ))}
        {versus.rows.map((row, r) => (
          <div key={r} className="contents">
            <h5
              className={cn(
                "mt-3.5 font-heading text-[15.5px]/[1.35] font-semibold @min-[560px]:col-span-full",
                "@min-[860px]:col-span-1 @min-[860px]:m-0 @min-[860px]:border-t @min-[860px]:border-hai-line-soft @min-[860px]:py-3.5 @min-[860px]:pr-5",
              )}
            >
              {row.topic}
            </h5>
            {sides.map((which) => (
              <p
                key={which}
                className={cn(
                  "m-0 bg-secondary px-3.5 py-3 font-sans text-[14.5px]/[1.5] text-muted-foreground",
                  "@min-[860px]:border-t @min-[860px]:border-hai-line-soft @min-[860px]:px-5 @min-[860px]:py-3.5",
                  which === "haikit"
                    ? "bg-[linear-gradient(var(--hai-accent-soft),var(--hai-accent-soft))] text-foreground @min-[860px]:border-x @min-[860px]:border-x-hai-accent/40"
                    : "@min-[860px]:mr-2.5",
                  which === "haikit" && r === versus.rows.length - 1 && "@min-[860px]:border-b @min-[860px]:border-b-hai-accent/40",
                )}
              >
                {/* the column heads name each side when wide, so the cells don't, except to a screen reader */}
                <span className={cn(KICKER, "mb-0.5 block text-xs @min-[860px]:sr-only", which === "haikit" ? "text-hai-accent" : "text-muted-foreground")}>
                  {versus[which].tag}
                  <span className="sr-only">: </span>
                </span>
                {row[which]}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * How the AI does a job with you, step by step in one of HaiKIT's demos, a
 * link to try it, and how it works underneath. The steps are a timeline: each
 * one's number on a rail, its words, and its scene, beside the words where
 * there's room and under them where there isn't.
 */
export function Example({ example, n }: { example: WelcomeProps["example"]; n: number }) {
  return (
    <Section n={n} head={example}>
      <ol className="grid list-none">
        {example.steps.map((step, i) => (
          <li
            key={i}
            className={cn(
              "relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 pb-[30px] last:pb-0",
              "@min-[720px]:grid-cols-[32px_minmax(0,2fr)_minmax(0,3fr)] @min-[720px]:gap-x-5 @min-[720px]:pb-[38px]",
              // the rail, from under this step's number down to the next one's
              "not-last:before:absolute not-last:before:top-10 not-last:before:bottom-2 not-last:before:left-[15px] not-last:before:w-0.5 not-last:before:bg-hai-line-soft",
            )}
          >
            <p className="col-start-1 row-start-1 grid size-8 place-items-center rounded-full border-[1.5px] border-hai-accent bg-card font-mono text-[13px] font-semibold text-hai-accent">
              <span className="sr-only">Step </span>
              {i + 1}
            </p>
            <div className="col-start-2 pt-[5px]">
              <h4 className="mb-[5px] font-heading text-base/[1.3] font-semibold text-balance">{step.title}</h4>
              <p className="mb-3.5 max-w-[46ch] font-sans text-sm/[1.5] text-muted-foreground @min-[720px]:mb-0">
                <Inline text={step.text} />
              </p>
            </div>
            {/* the whole width under the words, over the rail (positioned, so it paints above it) */}
            <SceneOf
              scene={step.scene}
              className="relative col-span-full min-h-0 justify-start gap-2 bg-hai-bg p-2.5 @min-[480px]:col-span-1 @min-[480px]:col-start-2 @min-[480px]:p-3 @min-[720px]:col-start-3 @min-[720px]:row-start-1"
            />
          </li>
        ))}
      </ol>
      {/* a site of its own, so a plain link: it never reaches the conversation */}
      {/^https:\/\//.test(example.demo.url) && (
        <p className="mt-[26px] flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <Button asChild size="lg" className="h-auto min-h-9 px-4 py-2 text-[13.5px]">
            <a href={example.demo.url} target="_blank" rel="noopener noreferrer" aria-label={`${example.demo.label} (opens in a new tab)`}>
              {example.demo.label} ↗
            </a>
          </Button>
          <span className="font-mono text-[13px] text-muted-foreground">{example.demo.url.replace(/^https:\/\/|\/$/g, "")}</span>
        </p>
      )}
      {/* underneath: the words beside the diagram once the diagram's wide drawing fits its column */}
      <div className="mt-[30px] grid gap-x-10 gap-y-1 border border-dashed border-hai-line px-6 pt-[22px] pb-1 max-sm:px-4 @min-[1060px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @min-[1060px]:items-center @min-[1060px]:pb-0">
        <div>
          <h4 className="mb-[5px] font-heading text-base/[1.3] font-semibold">{example.underneath.title}</h4>
          <p className="max-w-[54ch] font-serif text-[15px]/[1.55] text-muted-foreground">
            <Inline text={example.underneath.text} />
          </p>
        </div>
        <Architecture arch={example.underneath.architecture} />
      </div>
    </Section>
  );
}

/** "1,958" */
const count = (n: number) => n.toLocaleString("en-US");

/**
 * How HaiKIT saves tokens: a meter for each measured example, the tokens on
 * screen beside the tokens the AI read, then the ways it saves them, and where
 * to watch it on this page. The screen's bar is drawn in good, what stays in
 * the browser; the AI's in the accent, what the model receives.
 */
export function Tokens({ tokens, n }: { tokens: WelcomeProps["tokens"]; n: number }) {
  return (
    <Section n={n} head={tokens}>
      <div className="grid gap-3.5 @min-[760px]:grid-cols-2 @min-[760px]:gap-5">
        {tokens.examples.map((example, i) => {
          const kept = Math.round((1 - example.model / example.screen) * 100);
          const bars = [
            ["On screen", example.screen, "*:data-[slot=progress-indicator]:bg-hai-good"],
            ["The AI reads", example.model, "*:data-[slot=progress-indicator]:bg-hai-accent"],
          ] as const;
          return (
            <figure
              key={i}
              aria-label={`${example.name}: about ${count(example.screen)} tokens on screen, about ${count(example.model)} for the AI. ${kept}% never reaches the AI.`}
              className={cn(PANEL, "@container m-0 grid gap-3.5 px-[22px] py-5")}
            >
              <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-heading text-[15.5px]/[1.3] font-semibold">{example.name}</span>
                <span className="font-sans text-sm text-muted-foreground">
                  <strong className="mr-1 font-heading text-[26px]/none font-bold tracking-[-0.02em] text-hai-good">{kept}%</strong> never reaches the AI
                </span>
              </figcaption>
              {/* the figure's label says the same; narrow, each bar under its label and number */}
              <div aria-hidden className="grid gap-2.5 @min-[400px]:gap-2">
                {bars.map(([label, value, paint]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 [grid-template-areas:'label_n'_'track_track'] @min-[400px]:grid-cols-[6.8em_minmax(0,1fr)_7.6em] @min-[400px]:gap-2.5 @min-[400px]:[grid-template-areas:'label_track_n']"
                  >
                    <span className="font-sans text-[13px] text-muted-foreground [grid-area:label]">{label}</span>
                    <Progress value={Math.max(1.5, (value / example.screen) * 100)} className={cn("h-3 bg-hai-line-soft [grid-area:track]", paint)} />
                    <span className="text-right font-mono text-[13px] font-semibold tabular-nums [grid-area:n]">~{count(value)} tokens</span>
                  </div>
                ))}
              </div>
            </figure>
          );
        })}
      </div>
      <Points
        points={tokens.points}
        className="mt-[22px] gap-x-7 gap-y-[18px] @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-3 [&>li]:border-t-2 [&>li]:border-hai-accent/35 [&>li]:pt-3"
        marker={null}
      />
      <p className="mt-[22px] bg-hai-accent-soft px-4 py-3 font-sans text-[15px]/[1.5] [&_strong]:text-hai-accent">
        <Inline text={tokens.see} />
      </p>
    </Section>
  );
}

/** What building this way gives each audience, a card for each. */
export function Values({ values, n }: { values: WelcomeProps["values"]; n: number }) {
  return (
    <Section n={n} head={values}>
      <div className="grid gap-4 @min-[760px]:grid-cols-2 @min-[760px]:gap-5">
        {values.groups.map((group, i) => (
          <div key={i} className={cn(PANEL, "flex flex-col px-6 py-[22px] max-sm:px-4")}>
            <h4 className={cn(KICKER, "mb-4 text-muted-foreground")}>{group.audience}</h4>
            <Points
              points={group.points}
              className="gap-4 [&>li]:pl-8"
              marker={
                <span aria-hidden className="absolute top-0 left-0 grid size-[21px] place-items-center rounded-full bg-hai-good-soft font-heading text-xs font-bold text-hai-good">
                  ✓
                </span>
              }
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
