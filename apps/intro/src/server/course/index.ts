import type {
  Block,
  CheckpointProps,
  CourseMapProps,
  LessonProps,
  LessonRef,
  Term,
  WelcomeProps,
} from "../../shared/surfaces.ts";
import { excerpt } from "../excerpts.ts";
import { REFERENCE_TITLE, referenceRefs } from "../reference.ts";
import { TUTORIALS, tutorialRefs, tutorialSteps } from "../tutorial.ts";
import { part1 } from "./part1.ts";
import { part2 } from "./part2.ts";
import type { BlockDef, Check, LessonDef, PartDef } from "./types.ts";

export const PARTS: PartDef[] = [part1, part2];

export const GLOSSARY: Term[] = [
  { term: "elicitation app", aka: ["elicitation"], lesson: "1.1",
    definition: "An app where a tool asks the user something by rendering a component, and what the user does with it is the answer." },
  { term: "surface", aka: ["component", "surfaces"], lesson: "2.2",
    definition: "A UI component declared as a contract: its props, the actions that may reach the server, and the queries the model may run." },
  { term: "digest", aka: ["digests"], lesson: "1.3",
    definition: "The short text a rendered surface returns as its tool_result. It is all the model receives about the surface." },
  { term: "payload", aka: ["props"], lesson: "1.3",
    definition: "The full props of a rendered surface, stored on the server and streamed to the browser. It never enters the model's context." },
  { term: "handle", aka: ["handles", "ui_01", "pointer"], lesson: "1.3",
    definition: "An id such as ui_03 at the end of every digest. It points at a stored payload, and the model passes it to query_ui." },
  { term: "dual channel", aka: ["two channels", "channel", "channels"], lesson: "1.3",
    definition: "One tool execution producing two outputs: a digest for the model and a payload for the browser." },
  { term: "elicit", aka: ["elicit mode", "blocking"], lesson: "1.2",
    definition: "A render mode that parks the turn until the user answers through a resolve action." },
  { term: "display", aka: ["display mode"], lesson: "1.4",
    definition: "A render mode where the digest is returned at once and the turn carries on." },
  { term: "parked turn", aka: ["park", "parked", "parking", "awaiting"], lesson: "1.2",
    definition: "A turn waiting on an elicit surface: the history ends with an unanswered tool_use, the status is awaiting, and no connection is held open." },
  { term: "resolve", aka: ["resolve action"], lesson: "1.4",
    definition: "An action kind that answers the parked question. The click becomes the tool result and the turn resumes." },
  { term: "inform", aka: ["inform action"], lesson: "1.4",
    definition: "An action kind that adds a line to the conversation without having blocked anything." },
  { term: "freeze", aka: ["frozen"], lesson: "1.2",
    definition: "What happens to an elicit surface once its question is answered or closed: it can't be answered again." },
  { term: "query_ui", aka: ["query", "queries", "dereference"], lesson: "1.5",
    definition: "A tool derived from the queries surfaces declare. The model uses it to read part of a payload by handle." },
  { term: "cap", aka: ["capped", "cap()"], lesson: "1.5",
    definition: "The only way to build a query result. It limits rows by count and length, and says how many it left out." },
  { term: "pending", aka: ["pending record"], lesson: "1.6",
    definition: "The record of what a parked turn waits on: the tool_use id, the handle, the digest and any sibling results." },
  { term: "typed override", aka: ["override", "typing"], lesson: "1.6",
    definition: "Typing while a question waits. The question is closed with a tool result that quotes what the user typed." },
  { term: "staleAfterMs", aka: ["stale", "freshness window", "expired", "expiry"], lesson: "1.6",
    definition: "A surface's freshness window. Once it passes, the conversation refuses further requests and offers a new one." },
  { term: "contract", aka: ["defineSurface", "shared contract"], lesson: "2.2",
    definition: "The surface declaration both halves import. Its list of actions is the allowlist of what can reach the server." },
  { term: "implement", aka: ["server half", "implement()"], lesson: "2.3",
    definition: "The server's half of a surface: its digest, one handler per action and one function per query." },
  { term: "registry", aka: ["component registry"], lesson: "2.5",
    definition: "The browser's map from surface names to components. It is an allowlist: an unknown name renders an error card." },
  { term: "init", aka: ["init tool"], lesson: "2.4",
    definition: "A tool createHai runs at the start of every conversation, before the model's first turn." },
  { term: "adapter", aka: ["model adapter", "store adapter", "ModelAdapter", "StoreAdapter"], lesson: "2.6",
    definition: "A swappable implementation of an interface core declares. A model adapter has one generate method; a store has five methods." },
  { term: "lease", aka: ["turn lease", "fencing token", "leases"], lesson: "2.8",
    definition: "A per-conversation lock with a fencing token. It allows one turn at a time and rejects saves from overtaken requests." },
  { term: "mountChat", aka: ["default UI"], lesson: "2.6",
    definition: "The client call that builds the default UI: header, transcript, message box and the model context drawer." },
];

// ─────────────────────────────────────────────────── lessons

/** Option ids, by position. The browser shows them as A, B, C. */
export const OPTION_IDS = ["a", "b", "c", "d", "e"];

const ref = (l: LessonDef): LessonRef => ({ id: l.id, title: l.title, minutes: l.minutes, summary: l.summary });

function resolveBlock(block: BlockDef): Block {
  if (block.kind !== "excerpt") return block;
  const { code, source } = excerpt(block.file, block.pick);
  return { kind: "code", lang: block.lang, code, source, ...(block.caption ? { caption: block.caption } : {}) };
}

const ORDER = PARTS.flatMap((part) => part.lessons.map((lesson) => ({ part, lesson })));

/**
 * Every lesson, with its excerpts read now: at startup, so a selector that
 * stopped matching stops the server before it serves anyone.
 */
const LESSONS = new Map<string, LessonProps>(
  ORDER.map(({ part, lesson }, i) => [
    lesson.id,
    {
      blocks: lesson.blocks.map(resolveBlock),
      id: lesson.id,
      part: { n: part.n, title: part.title },
      position: { index: part.lessons.indexOf(lesson) + 1, total: part.lessons.length },
      title: lesson.title,
      minutes: lesson.minutes,
      summary: lesson.summary,
      takeaways: lesson.takeaways,
      next: ORDER[i + 1] ? ref(ORDER[i + 1].lesson) : null,
    },
  ]),
);

/** The answer key. Server-only: checkpoint props carry the options, never this. */
export const CHECKS = new Map<string, Check & { lessonTitle: string }>(
  ORDER.map(({ lesson }) => [lesson.id, { ...lesson.check, lessonTitle: lesson.title }]),
);

export const lessonIds = () => ORDER.map(({ lesson }) => lesson.id);

export const lessonProps = (id: string): LessonProps | null => LESSONS.get(id) ?? null;

/** A lesson's id, title, length and summary, or null for no such lesson. */
export function lessonRef(id: string): LessonRef | null {
  const lesson = ORDER.find((o) => o.lesson.id === id)?.lesson;
  return lesson ? ref(lesson) : null;
}

export function checkpointProps(id: string): CheckpointProps | null {
  const check = CHECKS.get(id);
  if (!check) return null;
  return {
    options: check.options.map((text, i) => ({ id: OPTION_IDS[i], text })),
    lessonId: id,
    lessonTitle: check.lessonTitle,
    question: check.question,
  };
}

/**
 * The welcome screen's words. It's written for a junior developer or a
 * product manager meeting HaiKIT for the first time: what software is like
 * today, what changes when the AI drives it, how that looks for a person, and
 * what it's worth. Every claim is something HaiKIT does today, and the lessons
 * or the Rebook demo show it: keep it that way.
 */
const INTRO = [
  "AI drives the software. You steer.",
  "This introduction is a HaiKIT app too. Each lesson is a tool result, each checkpoint waits for your click, and **Context**, at the top right, shows exactly what the model receives.",
];

const SUMMARY =
  "HaiKIT is an open-source TypeScript framework for a new kind of software. People say what needs to be done. " +
  "The AI runs the app's functions to do it, and asks people only for the decisions that are theirs.";

/** First: software as people drive it today, beside software the AI drives. */
const TODAY: WelcomeProps["today"] = {
  label: "The idea",
  title: "From clicking through screens to saying what you need",
  lead: "Most software is driven by people. HaiKIT builds software that the AI drives.",
  before: {
    label: "Today",
    title: "People drive the software",
    image: {
      kind: "screens",
      alt: "A screen crowded with menus, tabs, form fields and buttons. A numbered trail of seven clicks jumps around it to finish one job.",
    },
    points: [
      { title: "Screens full of controls", text: "Every function is a menu, a form or a button, somewhere on some screen." },
      { title: "You figure out the way", text: "To get a job done, you learn where to type and what to click, and in what order." },
      { title: "Nothing moves until you do", text: "The software waits at every step. Miss one, and you go back and look for it." },
    ],
  },
  after: {
    label: "With HaiKIT",
    title: "The AI drives the software",
    image: {
      kind: "request",
      alt: "One sentence asks for the job: get me to Tokyo by tomorrow. The AI answers with a card of the three flights that fit, and one click picks one.",
    },
    points: [
      { title: "Say what needs to be done", text: "In your own words, the way you'd ask a colleague. There are no menus to learn first." },
      { title: "The AI does the steps", text: "It picks the app's functions, runs them in the right order, and fills in what it already knows." },
      { title: "You steer", text: "When a decision is yours, it shows you just the options that fit, and waits for your click." },
    ],
  },
};

/**
 * How a HaiKIT app works, as the welcome screen draws it. The top row is the
 * way out (a tool call, its data), the bottom row the way back (a click,
 * which reaches the LLM as the tool's answer), and the digest between them.
 */
const ARCHITECTURE: WelcomeProps["example"]["underneath"]["architecture"] = {
  caption: "How a HaiKIT app works: one tool call, two channels.",
  description:
    "The LLM calls a tool. HaiKIT runs it, sends a short digest back to the LLM and the full data to your app. " +
    "A click in your app goes back through HaiKIT and reaches the LLM as the tool's answer.",
  nodes: [
    { name: "LLM", role: "decides what's next" },
    { name: "HaiKIT", role: "runs your tools", brand: true },
    { name: "Your app", role: "what people use" },
  ],
  links: [
    [
      { dir: "forward", channel: "model", row: 0, label: "calls a tool" },
      { dir: "back", channel: "model", row: 1, label: "short digest" },
      { dir: "back", channel: "model", row: 2, label: "your answer" },
    ],
    [
      { dir: "forward", channel: "ui", row: 0, label: "full data" },
      { dir: "back", channel: "ui", row: 2, label: "your click" },
    ],
  ],
};

/**
 * Second: how the AI does a job with you, in the Rebook demo. Each step is
 * something Rebook does on its 60-second path (see apps/rebook's README).
 */
const EXAMPLE: WelcomeProps["example"] = {
  label: "How it works",
  title: "The AI does the job with you",
  lead: "Here's Rebook, a demo built with HaiKIT, on a bad day: the airline has just cancelled your flight to Tokyo.",
  steps: [
    {
      title: "It speaks first",
      text: "The airline's system reports the cancellation. The AI hears it and tells you before you ask, with every way to get there.",
      scene: [
        { from: "world", text: "Airline: UA 837 cancelled" },
        { from: "ai", text: "I'm sorry: your flight to Tokyo was cancelled. Here are 14 ways to get there." },
      ],
    },
    {
      title: "You ask in your own words",
      text: "There's no filter to find. The AI looks your question up in the options on your screen, and shows the ones that match.",
      scene: [
        { from: "you", text: "Which are nonstop?" },
        { from: "ai", text: "5 of the 14 options are. Here they are." },
      ],
    },
    {
      title: "You decide with a click",
      text: "Nothing is booked until you choose. The AI waits for your click, then carries on with exactly the flight you picked.",
      scene: [
        { from: "click", text: "NH 7 · Wed 11:00 · nonstop" },
        { from: "ai", text: "NH 7 it is. Pick a seat." },
      ],
    },
    {
      title: "It keeps up with the world",
      text: "When the gate moves after you've booked, your boarding pass changes in place, and the AI tells you.",
      scene: [
        { from: "world", text: "Airline: NH 7 gate changed" },
        { from: "ai", text: "Heads up: your gate moved. Boarding time is the same." },
      ],
    },
  ],
  demo: { label: "Try Rebook", url: "https://rebook.haikit.app/" },
  underneath: {
    title: "Underneath, for developers",
    text:
      "The AI, an LLM such as Claude, never touches the screen. It calls your app's functions as tools. HaiKIT runs each one, " +
      "sends the full result to the screen and a short summary to the AI, and a click goes back to the AI as the tool's answer.",
    architecture: ARCHITECTURE,
  },
};

/** Third: what building this way gives the people who use the software, and the team that builds it. */
const VALUES: WelcomeProps["values"] = {
  label: "Why it matters",
  title: "What you get",
  lead: "Building this way pays off for the people who use your software, and for the team that builds it.",
  groups: [
    {
      audience: "For the people who use it",
      points: [
        { title: "Nothing to learn", text: "They say what they need. No menus to memorise, no manual, no training." },
        {
          title: "Straight to the result",
          text: "The AI does the steps in between, so a job takes a sentence and a few clicks, not a tour of the screens.",
        },
        {
          title: "Always in control",
          text: "When a choice is theirs, the AI asks. Their click arrives as an exact value, never the AI's guess at what they meant.",
        },
      ],
    },
    {
      audience: "For the team that builds it",
      points: [
        {
          title: "Built from what you already write",
          text: "Your functions become the AI's tools, and your components are what it shows. Plain TypeScript, open source under MIT.",
        },
        {
          title: "Checked before it ships",
          text: "Each component is declared once, and TypeScript holds the server and the browser to it. A button can send only what you declared.",
        },
        {
          title: "Cheap to run, ready to scale",
          text: "The AI reads a short summary of each result, not the data: in the flights example, 97% never reaches it. Conversations live in Postgres and survive restarts.",
        },
      ],
    },
  ],
};

/** Apps built with HaiKIT, each running on its own site: the menu's Demo list. */
const DEMOS = [
  {
    title: "Rebook",
    detail: "The airline cancels your flight. The AI tells you first and rebooks you; you steer with clicks.",
    url: "https://rebook.haikit.app/",
  },
];

/** HaiKIT's repository and its packages. */
const LINKS: WelcomeProps["links"] = [
  { site: "github", label: "wfoxd/haikit", url: "https://github.com/wfoxd/haikit" },
  { site: "npm", label: "@haikit", url: "https://www.npmjs.com/search?q=haikit" },
];

/**
 * HaiKIT's tutorial, as the welcome screen lists it: its numbered steps, read
 * from the tutorial itself (see ../tutorial.ts), so the list can't drift from
 * the pages it opens.
 */
const TUTORIAL_PANEL: WelcomeProps["tutorial"] = {
  title: "Build your first HaiKIT app",
  lead: "Hello, World! in whichever language the world picks: ten steps, annotated line by line, about 150 lines in all. Read it right here.",
  steps: tutorialSteps(1),
  // the second tutorial, which carries on with the same app
  next: {
    title: "Tell them later",
    lead: "The same app, speaking up after the request is over: progress, notices, a turn the model starts, and a picker that changes while you look at it.",
    first: tutorialRefs(2)[0]!,
    steps: tutorialSteps(2).length,
  },
};

/** How the course map and the menu name each tutorial, and what it builds. */
const TUTORIAL_NAMES: Record<number, { title: string; blurb: string }> = {
  1: { title: TUTORIAL_PANEL.title, blurb: "Build a Hello, World! app with HaiKIT, step by step, read right here." },
  2: { title: TUTORIAL_PANEL.next!.title, blurb: "Teach the same app to speak up later: progress, notices, wake turns and live updates." },
};

/** The reference manual, as the welcome screen offers it: every page, read from the manual itself. */
const REFERENCE_PANEL: WelcomeProps["reference"] = {
  title: REFERENCE_TITLE,
  lead: "Look something up: what each function takes, returns and refuses, every option and its default, and every limit HaiKIT applies.",
  pages: referenceRefs(),
};

export const welcomeProps = (): WelcomeProps => ({
  intro: INTRO,
  summary: SUMMARY,
  links: LINKS,
  today: TODAY,
  example: EXAMPLE,
  values: VALUES,
  tutorial: TUTORIAL_PANEL,
  reference: REFERENCE_PANEL,
  parts: PARTS.map((p) => ({
    n: p.n,
    title: p.title,
    first: p.lessons[0].id,
    last: p.lessons.at(-1)!.id,
    lessons: p.lessons.length,
    minutes: p.lessons.reduce((m, l) => m + l.minutes, 0),
  })),
  first: ref(ORDER[0].lesson),
});

/**
 * What the header's menu lists: every lesson by part, each tutorial's
 * numbered steps, the reference manual's pages, and the demos. Served as
 * /menu.json; the menu is navigation, not a surface, so it reaches the
 * conversation the way typing does. A demo is a site of its own, so it's a
 * link instead, and never reaches the conversation.
 */
export const menu = () => ({
  lessons: PARTS.map((p) => ({ part: p.n, title: p.title, lessons: p.lessons.map((l) => ({ id: l.id, title: l.title })) })),
  tutorials: TUTORIALS.map((t) => ({
    title: TUTORIAL_NAMES[t.n]!.title,
    steps: tutorialSteps(t.n).map(({ id, title }) => ({ id, title })),
  })),
  reference: { title: REFERENCE_TITLE, pages: referenceRefs() },
  demos: DEMOS,
});

export const courseMapProps = (): CourseMapProps => ({
  glossary: GLOSSARY,
  parts: PARTS.map((p) => ({ n: p.n, title: p.title, blurb: p.blurb, lessons: p.lessons.map(ref) })),
  tutorials: TUTORIALS.map((t) => ({ ...TUTORIAL_NAMES[t.n]!, pages: tutorialRefs(t.n) })),
});
