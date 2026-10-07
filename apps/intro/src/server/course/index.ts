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
import { tutorialRefs } from "../tutorial.ts";
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

/** The welcome screen's introduction: kept short, the lessons do the teaching. */
const INTRO = [
  "Build whole apps with an LLM, not just chats that call one.",
  "This introduction is a HaiKIT app too. Each lesson is a tool result, each checkpoint waits for your click, and **Context**, at the top right, shows exactly what the model receives.",
];

/**
 * How a HaiKIT app works, as the welcome screen draws it. The top row is the
 * way out (a tool call, its data), the bottom row the way back (a click,
 * which reaches the LLM as the tool's answer), and the digest between them.
 */
const ARCHITECTURE: WelcomeProps["architecture"] = {
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
 * The welcome screen's sections. Every claim here is something HaiKIT does
 * today, and the lessons show the code behind it: keep it that way.
 */
const SECTIONS: WelcomeProps["sections"] = [
  {
    title: "Why build your product on HaiKIT",
    lead: "For the people deciding what to build on.",
    image: {
      kind: "payload-split",
      alt: "One tool call splits in two: the full data goes to your app, and a short digest goes to the LLM. 97% of the data never reaches the model.",
    },
    points: [
      {
        title: "Smaller model bills",
        text: "The model gets a few sentences about each result, not the data itself. In the flights example, 97% of the payload never enters its context.",
      },
      {
        title: "Answers your code can act on",
        text: "People answer by clicking, so a choice arrives as a validated value, not prose the model has to interpret.",
      },
      {
        title: "Safety the compiler checks",
        text: "A button can only send an action your contract declares, and a missing summary or an unbounded query fails the build.",
      },
    ],
  },
  {
    title: "What the LLM brings to your app",
    lead: "The LLM isn't a feature bolted on. It runs the app.",
    image: {
      kind: "llm-flow",
      alt: "The LLM chooses between tools such as search, compare and ask you. Asking shows a component with options, and it waits for your click.",
    },
    points: [
      {
        title: "It runs the flow",
        text: "The LLM reads each request and picks the next tool, so the app adapts to every person instead of following a fixed script.",
      },
      {
        title: "It speaks plainly",
        text: "People ask in their own words. The LLM answers from what it was shown and looks up more on demand, never from rows it hasn't seen.",
      },
      {
        title: "It asks when it must",
        text: "When a decision is needed, it shows a component and waits, for seconds or days, then carries on with the exact answer.",
      },
    ],
  },
  {
    title: "What HaiKIT gives you",
    lead: "The values you get by building this way.",
    image: {
      kind: "contract-split",
      alt: "One contract, declared with defineSurface, feeds a server half and a browser half, and TypeScript checks both against it.",
    },
    points: [
      {
        title: "One contract, two halves",
        text: "Declare each component once. TypeScript holds the server and the browser to it, so a mismatch breaks the build, not production.",
      },
      {
        title: "Ready for production",
        text: "Conversations survive restarts in Postgres, several servers share them safely, and stale data is refused instead of acted on.",
      },
      {
        title: "Open, and yours to change",
        text: "MIT licensed. Claude and Postgres support ship with it; other models and stores plug in behind small interfaces.",
      },
    ],
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
  steps: tutorialRefs().filter((page) => /^\d+$/.test(page.id)),
};

export const welcomeProps = (): WelcomeProps => ({
  intro: INTRO,
  tutorial: TUTORIAL_PANEL,
  links: LINKS,
  architecture: ARCHITECTURE,
  sections: SECTIONS,
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
 * What the header's menu lists: every lesson by part, and the tutorial's
 * numbered steps. Served as /menu.json; the menu is navigation, not a surface,
 * so it reaches the conversation the way typing does.
 */
export const menu = () => ({
  lessons: PARTS.map((p) => ({ part: p.n, title: p.title, lessons: p.lessons.map((l) => ({ id: l.id, title: l.title })) })),
  tutorial: tutorialRefs()
    .filter((page) => /^\d+$/.test(page.id))
    .map(({ id, title }) => ({ id, title })),
});

export const courseMapProps = (): CourseMapProps => ({
  glossary: GLOSSARY,
  parts: PARTS.map((p) => ({ n: p.n, title: p.title, blurb: p.blurb, lessons: p.lessons.map(ref) })),
  tutorial: { title: TUTORIAL_PANEL.title, pages: tutorialRefs() },
});
