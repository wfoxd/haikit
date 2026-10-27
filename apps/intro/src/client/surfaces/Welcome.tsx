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

const LABEL = "font-heading text-[13px] font-semibold text-hai-accent";
const TITLE = "mt-1 font-heading text-[19px]/[1.25] font-semibold tracking-[-0.01em]";
const LEAD = "mt-1.5 mb-3.5 font-serif text-[15px]/[1.5] text-muted-foreground";

type Panel = { open: boolean; picked: unknown; choose: (id: string) => void };

/**
 * HaiKIT's tutorial as a panel: a button to start it, and its steps, each a
 * button that opens that step here, then the tutorial that carries on from it.
 * Choosing one answers the welcome screen's question, through its declared
 * `tutorial` action.
 */
/** The tutorials after the first: `more`, or, on a welcome saved before version 15, its one `next`. */
type Later = WelcomeProps["tutorial"]["more"][number];
const laterOf = (tutorial: WelcomeProps["tutorial"]): Later[] => {
  const next = (tutorial as { next?: Later }).next;
  return tutorial.more ?? (next ? [next] : []);
};

function TutorialPanel({ tutorial, open, picked, choose }: Panel & { tutorial: WelcomeProps["tutorial"] }) {
  return (
    <section className={cn(PANEL, "flex flex-col px-[26px] pt-6 pb-[22px] max-sm:px-4 max-sm:py-[18px]")}>
      <p className={LABEL}>Tutorial</p>
      <h3 className={TITLE}>{tutorial.title}</h3>
      <p className={LEAD}>
        <Inline text={tutorial.lead} />
      </p>
      <ol className="mb-5 grid list-none gap-px">
        {tutorial.steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              disabled={!open}
              onClick={() => choose(step.id)}
              className={cn(
                "-mx-2 grid w-[calc(100%+16px)] cursor-pointer grid-cols-[2.3em_minmax(0,1fr)] items-baseline px-2 py-1 text-left font-sans text-[14.5px]/[1.4]",
                "enabled:hover:bg-hai-hover enabled:hover:[&>span:last-child]:underline enabled:hover:[&>span:last-child]:underline-offset-2 disabled:cursor-default disabled:text-muted-foreground",
                step.id === picked && "bg-hai-selected disabled:text-foreground",
              )}
            >
              <span className="font-mono text-[12.5px] font-semibold text-hai-accent tabular-nums">{step.id}</span>
              <span>{step.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <Choice className="mt-auto self-start" picked={picked === "intro"} disabled={!open} onClick={() => choose("intro")}>
        Start the tutorial
      </Choice>
      {/* The tutorials that carry on with the same app, each after the last. */}
      {laterOf(tutorial).map((next) => (
        <div key={next.first.id} className="mt-[18px] border-t border-hai-line pt-3.5">
          <button
            type="button"
            disabled={!open}
            onClick={() => choose(next.first.id)}
            className="flex w-full cursor-pointer flex-col items-start gap-0.5 text-left disabled:cursor-default enabled:hover:[&>span:last-child]:underline enabled:hover:[&>span:last-child]:underline-offset-2"
          >
            <span className={LABEL}>Then</span>
            <span className={cn("font-heading text-base/[1.25] font-semibold", picked === next.first.id && "text-hai-accent")}>{next.title}</span>
          </button>
          <p className="mt-1 font-serif text-sm/[1.5] text-muted-foreground">
            <Inline text={`${next.lead} ${next.steps} steps.`} />
          </p>
        </div>
      ))}
    </section>
  );
}

/**
 * The reference manual as a panel: each of its pages, a button that opens it
 * here, the contents first. Choosing one answers the welcome screen's question
 * through its declared `reference` action, as the tutorial panel's steps do.
 */
function ReferencePanel({ reference, open, picked, choose }: Panel & { reference: WelcomeProps["reference"] }) {
  return (
    <section
      className={cn(
        PANEL,
        "col-span-full grid gap-x-7 gap-y-3.5 px-[26px] py-[22px] max-sm:px-4 @min-[620px]/page:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @min-[620px]/page:items-start",
      )}
    >
      <div>
        <p className={LABEL}>Reference</p>
        <h3 className={TITLE}>{reference.title}</h3>
        <p className={cn(LEAD, "mb-0")}>
          <Inline text={reference.lead} />
        </p>
      </div>
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
    </section>
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

        {/* The close: where to begin here, beside the tutorial for building your own. */}
        <div className={cn("grid gap-4 @min-[620px]/page:grid-cols-2", story ? "mt-12 border-t border-hai-line-soft pt-10 max-sm:mt-9 max-sm:pt-[30px]" : "mt-9")}>
          {story && <p className={cn(KICKER, "col-span-full -mb-1 text-hai-accent")}>Start here</p>}
          <div className={cn(PANEL, "flex flex-col px-[26px] pt-6 pb-[22px] max-sm:px-4 max-sm:py-[18px]")}>
            {rest.map((paragraph, i) => (
              <p key={i} className="mb-3 max-w-[58ch] font-serif text-[17px]/[1.6] max-sm:text-base [&_strong]:font-semibold">
                <Inline text={paragraph} />
              </p>
            ))}
            <p className="mt-[18px] mb-5 text-[13.5px] text-muted-foreground">
              {props.parts.length} parts, {lessons} lessons, about {minutes} minutes
            </p>
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
            {!live && state === "frozen" && <Closed>{done}</Closed>}
          </div>
          {/* Version 7 linked out to the tutorial, and earlier versions had none. */}
          {props.tutorial && props.tutorial.steps.every((st) => typeof st.id === "string") && (
            <TutorialPanel tutorial={props.tutorial} open={open} picked={picked} choose={(id) => void pick(id, () => send("tutorial", id))} />
          )}
          {/* a welcome stored before version 10 has no reference */}
          {props.reference && (
            <ReferencePanel reference={props.reference} open={open} picked={picked} choose={(id) => void pick(id, () => send("reference", id))} />
          )}
        </div>
      </div>
    </div>
  );
}
