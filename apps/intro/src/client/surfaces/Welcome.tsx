import { useRef, type ReactNode } from "react";
import type { SurfaceProps } from "@haikit/react";
import type { WelcomeProps, welcomeScreen } from "../../shared/surfaces.ts";
import { Button } from "@/components/ui/button";
import { useAnswer } from "@/lib/answer";
import { scrollTranscript } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import { Inline } from "../blocks/inline.tsx";
import { Logo } from "../drawings/Logo.tsx";
import { Choice, Choices, Closed, useShowTop } from "./parts.tsx";
import { Example, KICKER, PANEL, Today, Tokens, Values, Versus } from "./Story.tsx";
import { LegacyStory, type LegacyWelcome } from "./WelcomeLegacy.tsx";

/**
 * A welcome as it may have been stored: every version from 1 still renders.
 * Version 5 had one GitHub link as `source`; the story's sections came at 11,
 * the comparison at 12, the tokens at 13; the tutorial at 7 and the
 * reference at 10.
 */
type Stored = Omit<WelcomeProps, "links" | "today" | "versus" | "example" | "tokens" | "values" | "tutorial" | "reference"> &
  Partial<Pick<WelcomeProps, "links" | "today" | "versus" | "example" | "tokens" | "values" | "tutorial" | "reference">> & {
    source?: { label: string; url: string };
  } & LegacyWelcome;

/** Each site's mark, drawn in the text colour: [viewBox, path, name]. */
const SITES = {
  // Octicons mark-github (MIT)
  github: [
    "0 0 16 16",
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
    "GitHub",
  ],
  // Simple Icons npm (CC0)
  npm: [
    "0 0 24 24",
    "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
    "npm",
  ],
} as const;

/**
 * A link to where HaiKIT lives. It's a plain link, not a declared action, so
 * it never reaches the conversation. Only an https URL becomes one.
 */
function SiteLink({ link }: { link: WelcomeProps["links"][number] }) {
  const [viewBox, path, name] = SITES[link.site] ?? SITES.github;
  if (!/^https:\/\//.test(link.url)) return null;
  return (
    <Button asChild variant="outline" size="lg" className="h-auto gap-2 py-[7px] pr-3.5 pl-3 text-[13.5px] font-semibold">
      <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} on ${name} (opens in a new tab)`}>
        <svg viewBox={viewBox} aria-hidden className="size-4 fill-current">
          <path d={path} />
        </svg>
        <span>{link.label}</span>
      </a>
    </Button>
  );
}

const LEAD = "font-serif text-[15px]/[1.5] text-muted-foreground";
const NUMBER = "font-mono text-[12.5px] font-semibold text-hai-accent tabular-nums";

type Panel = { open: boolean; picked: unknown; choose: (id: string) => void };

/**
 * One way in, as a panel: its name, how much it holds, what's in it, and the
 * button that starts it, at its foot. Side by side, the doors are as tall as
 * the tallest, so their buttons line up.
 */
function Door({ name, size, className, children }: { name: string; size: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn(PANEL, "flex flex-col gap-4 px-6 pt-5 pb-[22px] max-sm:px-4 max-sm:py-[18px]", className)}>
      <header className="border-b border-hai-line-soft pb-3">
        <h3 className="font-heading text-[19px]/[1.25] font-semibold tracking-[-0.01em]">{name}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{size}</p>
      </header>
      {children}
    </section>
  );
}

/** The tutorials after the first: `more`, or, on a welcome saved before version 15, its one `next`. */
type Later = WelcomeProps["tutorial"]["more"][number];
const laterOf = (tutorial: WelcomeProps["tutorial"]): Later[] => {
  const next = (tutorial as { next?: Later }).next;
  return tutorial.more ?? (next ? [next] : []);
};

/**
 * HaiKIT's tutorials as a door: each one in order, numbered, with what it
 * builds and how many steps it takes. Its title opens its first page here,
 * as the button at the foot does the first tutorial's. Choosing one answers
 * the welcome screen's question, through its declared `tutorial` action.
 */
function TutorialDoor({ tutorial, open, picked, choose }: Panel & { tutorial: WelcomeProps["tutorial"] }) {
  const all = [
    { first: "intro", title: tutorial.title, lead: tutorial.lead, steps: tutorial.steps.length },
    ...laterOf(tutorial).map((t) => ({ first: t.first.id, title: t.title, lead: t.lead, steps: t.steps })),
  ];
  const steps = all.reduce((n, t) => n + t.steps, 0);
  return (
    <Door name="Tutorials" size={`${all.length} ${all.length === 1 ? "tutorial" : "tutorials"}, ${steps} steps`}>
      <ol className="grid list-none gap-3.5">
        {all.map((t, i) => (
          <li key={t.first} className="grid grid-cols-[1.5em_minmax(0,1fr)] gap-x-1">
            <span className={cn(NUMBER, "text-[13px]/[1.6]")}>{i + 1}</span>
            <div>
              <button
                type="button"
                disabled={!open}
                onClick={() => choose(t.first)}
                className={cn(
                  "-mx-1.5 cursor-pointer px-1.5 text-left font-heading text-base/[1.35] font-semibold disabled:cursor-default",
                  "enabled:hover:bg-hai-hover enabled:hover:underline enabled:hover:underline-offset-2",
                  t.first === picked && "bg-hai-selected text-hai-accent",
                )}
              >
                {t.title}
              </button>{" "}
              <span className="text-[13px] whitespace-nowrap text-muted-foreground">{t.steps} steps</span>
              <p className="mt-0.5 font-serif text-sm/[1.5] text-muted-foreground">
                <Inline text={t.lead} />
              </p>
            </div>
          </li>
        ))}
      </ol>
      <Choice className="mt-auto self-start" picked={picked === "intro"} disabled={!open} onClick={() => choose("intro")}>
        Start the tutorial
      </Choice>
    </Door>
  );
}

/**
 * The reference manual as a door: each of its pages, a button that opens it
 * here, the contents first. Choosing one answers the welcome screen's question
 * through its declared `reference` action, as a tutorial's title does.
 */
function ReferenceDoor({ reference, open, picked, choose, className }: Panel & { reference: WelcomeProps["reference"]; className?: string }) {
  return (
    <Door name="Reference" size={`${reference.title}, ${reference.pages.length} pages`} className={className}>
      <p className={LEAD}>
        <Inline text={reference.lead} />
      </p>
      <ul className="flex list-none flex-wrap gap-1.5">
        {reference.pages.map((page) => (
          <li key={page.id}>
            <Button
              variant="outline"
              size="sm"
              disabled={!open}
              onClick={() => choose(page.id)}
              className={cn(
                "h-auto py-[5px] text-sm/[1.3] font-normal",
                page.id === "index" && "border-hai-accent font-semibold text-hai-accent",
                page.id === picked && "bg-hai-selected text-foreground disabled:opacity-100",
              )}
            >
              {page.title}
            </Button>
          </li>
        ))}
      </ul>
    </Door>
  );
}

/**
 * The welcome screen: the logo, the story, and its question, where to begin.
 * Every choice here answers it: `begin` for the two buttons, `tutorial` for a
 * page of the tutorial, `reference` for a page of the manual.
 */
export function Welcome({ props: current, send, mode, state, selection }: SurfaceProps<typeof welcomeScreen>) {
  const props = current as Stored;
  const root = useRef<HTMLDivElement>(null);
  const { live, open, picked, answer } = useAnswer({ state, mode, selection });
  // Taller than the window, it would open on its last lines: show its top.
  useShowTop(root, state);

  /** Answer, then follow again, so the reply and what it shows stream into view. */
  const pick = (value: string, go: () => Promise<void>) =>
    answer(value, () => {
      scrollTranscript(root.current?.parentElement, "bottom");
      return go();
    });

  const links = props.links ?? (props.source ? [{ site: "github" as const, ...props.source }] : []);
  const [lede, ...rest] = props.intro;
  const story = !!props.today;

  // The lede, a sentence each, so a wide page can give each its own line.
  const sentences = (lede ?? "").split(/(?<=[.!?])\s+/);
  const ledeOf = (className: string, sentence: string) => (
    <p className={cn("font-heading font-semibold text-balance", className)}>
      {sentences.map((s, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={sentence}>
            <Inline text={s} />
          </span>
        </span>
      ))}
    </p>
  );

  // the story's sections, numbered in order; a welcome stored at version 11
  // has no comparison, and one stored before 13 no tokens section
  const sections: ((n: number) => ReactNode)[] = [];
  if (props.today) {
    const { today, versus, example, tokens, values } = props;
    sections.push((n) => <Today key="today" today={today} n={n} />);
    if (versus) sections.push((n) => <Versus key="versus" versus={versus} n={n} />);
    if (example) sections.push((n) => <Example key="example" example={example} n={n} />);
    if (tokens) sections.push((n) => <Tokens key="tokens" tokens={tokens} n={n} />);
    if (values) sections.push((n) => <Values key="values" values={values} n={n} />);
  }

  const lessons = props.parts.reduce((n, p) => n + p.lessons, 0);
  const minutes = props.parts.reduce((n, p) => n + p.minutes, 0);
  const choices = [
    { value: "first-lesson", label: `Start with lesson ${props.first.id}`, primary: true },
    { value: "course-map", label: "See the course map" },
  ] as const;

  // Version 7 linked out to the tutorial, and earlier versions had none; a
  // welcome stored before version 10 has no reference.
  const tutorial = props.tutorial?.steps.every((st) => typeof st.id === "string") ? props.tutorial : undefined;
  const doors = 1 + Number(!!tutorial) + Number(!!props.reference);

  const manual = props.reference?.pages.find((p) => p.id === picked);
  // a tutorial that carries on, started from its first page
  const started = props.tutorial ? laterOf(props.tutorial).find((t) => t.first.id === picked) : undefined;
  const done =
    picked === "first-lesson"
      ? `You started with lesson ${props.first.id}.`
      : picked === "course-map"
        ? "You opened the course map."
        : manual
          ? manual.id === "index"
            ? "You opened the reference manual."
            : `You opened ${manual.title} in the reference manual.`
          : picked === "intro"
            ? "You started the tutorial."
            : started
              ? `You started ${started.title}.`
              : typeof picked === "string"
                ? `You opened step ${picked} of the tutorial.`
                : "Closed when you typed instead of choosing.";

  return (
    <div ref={root} className="px-10 pt-10 pb-[34px] max-sm:px-[18px] max-sm:pt-[26px] max-sm:pb-[22px]">
      {/* the content, on a page at most 1180px wide, centred in however wide a card */}
      <div className="@container/page mx-auto max-w-[1180px]">
        <div className="mb-[26px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3.5">
          <h2 className="leading-none">
            <Logo className="block h-[46px] w-auto max-w-full max-sm:h-9" />
          </h2>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <SiteLink key={link.url} link={link} />
              ))}
            </div>
          )}
        </div>

        {story ? (
          <>
            {/* The lede and what HaiKIT is. With room, side by side: the lede large on the left, a sentence to a line. */}
            <div className="mt-1 grid gap-3.5 @min-[860px]/page:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] @min-[860px]/page:items-end @min-[860px]/page:gap-12">
              {ledeOf("max-w-[20ch] text-[clamp(28px,4.2cqi,50px)]/[1.08] tracking-[-0.03em] @min-[860px]/page:max-w-none", "@min-[860px]/page:block")}
              <p className="max-w-[52ch] font-serif text-lg/[1.55] text-pretty text-muted-foreground max-sm:text-[16.5px]">
                <Inline text={props.summary} />
              </p>
            </div>
            {sections.map((draw, i) => draw(i + 1))}
          </>
        ) : (
          <LegacyStory
            props={props}
            lede={ledeOf(
              "mb-3.5 max-w-[26ch] text-[28px]/[1.2] tracking-[-0.02em] max-sm:text-[22px] @min-[1120px]/page:m-0 @min-[1120px]/page:max-w-none @min-[1120px]/page:text-[40px]/[1.1] @min-[1120px]/page:tracking-[-0.025em]",
              "@min-[1120px]/page:block",
            )}
          />
        )}

        {/*
          The close: where to begin, three ways in. With room, side by side, as
          tall as each other; with less, the manual goes under the other two.
        */}
        <div
          className={cn(
            "grid gap-4",
            doors > 1 && "@min-[620px]/page:grid-cols-2",
            doors > 2 && "@min-[980px]/page:grid-cols-3",
            story ? "mt-12 border-t border-hai-line-soft pt-10 max-sm:mt-9 max-sm:pt-[30px]" : "mt-9",
          )}
        >
          {story && <p className={cn(KICKER, "col-span-full -mb-1 text-hai-accent")}>Start here</p>}
          <Door name="Course" size={`${props.parts.length} parts, ${lessons} lessons, about ${minutes} minutes`}>
            {rest.map((paragraph, i) => (
              <p key={i} className="max-w-[58ch] font-serif text-base/[1.55] [&_strong]:font-semibold">
                <Inline text={paragraph} />
              </p>
            ))}
            <ol className="list-none border-t border-hai-line-soft">
              {props.parts.map((part) => (
                <li
                  key={part.n}
                  className="grid grid-cols-[4.4em_minmax(0,1fr)_auto] items-baseline gap-x-2 border-b border-hai-line-soft py-2 font-sans text-[14.5px]/[1.35]"
                >
                  <span className={NUMBER}>
                    {part.first}–{part.last}
                  </span>
                  <span>{part.title}</span>
                  <span className="text-[13px] whitespace-nowrap text-muted-foreground">{part.minutes} min</span>
                </li>
              ))}
            </ol>
            {/* The two buttons are this screen's question. */}
            <Choices className="mt-auto">
              {choices.map((c) => (
                <Choice
                  key={c.value}
                  primary={"primary" in c}
                  picked={c.value === picked}
                  disabled={!open}
                  onClick={() => pick(c.value, () => send("begin", c.value))}
                >
                  {c.label}
                </Choice>
              ))}
            </Choices>
          </Door>
          {tutorial && <TutorialDoor tutorial={tutorial} open={open} picked={picked} choose={(id) => void pick(id, () => send("tutorial", id))} />}
          {props.reference && (
            <ReferenceDoor
              reference={props.reference}
              open={open}
              picked={picked}
              choose={(id) => void pick(id, () => send("reference", id))}
              // two doors above it, or one beside it
              className={cn(doors > 2 && "@min-[620px]/page:col-span-2 @min-[980px]/page:col-span-1")}
            />
          )}
          {!live && state === "frozen" && (
            <div className="col-span-full -mt-2">
              <Closed>{done}</Closed>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
