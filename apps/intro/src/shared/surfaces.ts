/**
 * The contract for the course's surfaces. Both halves import this file:
 * the server implements it in ../server/surfaces.ts, and the browser renders it
 * in ../../public/components.js, typechecked against the types below.
 *
 * The #region markers are read by the server at startup: Part 2 of the course
 * shows these exact lines, so the lessons can never drift from the code.
 */

import { defineSurface, query, resolve, type Infer } from "@haikit/core";
import { z } from "zod";

// ─────────────────────────────────────────────────── lesson content

/** The lanes of a sequence diagram. */
export const Lane = z.enum(["browser", "server", "model"]);

export const Step = z.object({
  from: Lane,
  to: Lane,
  label: z.string(),
  note: z.string(),
  /** Which channel the step travels on: model context, browser payload, or a parked turn. */
  tone: z.enum(["model", "ui", "park"]).optional(),
});

export const Side = z.object({
  title: z.string(),
  tone: z.enum(["bad", "good"]),
  /** Text showing what this side looks like, such as a model's prose question. */
  sample: z.string().optional(),
  /**
   * Or a working select list, for a side that asks with a component. Choosing
   * an option is local to the lesson: it shows what the click would send.
   */
  picker: z
    .object({
      caption: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string() })),
      /** Options the list holds beyond those shown. */
      more: z.number().optional(),
    })
    .optional(),
  text: z.string(),
});

/** The body of a code note or a callout: paragraphs and lists. */
export const Prose = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("p"), text: z.string() }),
  z.object({ kind: z.literal("list"), items: z.array(z.string()) }),
]);

/**
 * One piece of a lesson, a tutorial step or a reference page. Text fields allow
 * `code`, **bold**, *italic* and [links](ref:tools#query_ui) inline; the browser
 * turns those into elements, never into HTML.
 *
 * A link's target is one of: `#anchor` on the same page, `ref:page` or
 * `ref:page#anchor` for a page of the reference, `tutorial:id` for a tutorial
 * page, or an https URL. The server writes them that way when it reads the
 * Markdown, so the browser never resolves a relative path.
 */
export const Block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("p"), text: z.string() }),
  z.object({
    kind: z.literal("h"),
    text: z.string(),
    /** A reference page's ## is 2, ### is 3, #### is 4. A lesson's or a tutorial's heading has none. */
    level: z.number().optional(),
    /** The anchor a link reaches it by: GitHub's, so the manual's own links work unchanged. */
    id: z.string().optional(),
  }),
  z.object({ kind: z.literal("list"), items: z.array(z.string()) }),
  /**
   * A reference page's list, whose items can hold paragraphs, code and lists
   * of their own: each item is its blocks.
   */
  z.object({
    kind: z.literal("items"),
    ordered: z.boolean(),
    /** The first number of an ordered list, when it isn't 1. */
    start: z.number().optional(),
    get items() {
      return z.array(z.array(Block));
    },
  }),
  z.object({ kind: z.literal("note"), tone: z.enum(["look", "tip", "warn"]), text: z.string() }),
  z.object({
    kind: z.literal("code"),
    lang: z.enum(["ts", "tsx", "js", "json", "css", "html", "bash", "text"]),
    code: z.string(),
    /** Where it was read from, e.g. "src/shared/surfaces.ts, lines 40–58". */
    source: z.string().optional(),
    caption: z.string().optional(),
    /** The file this code goes in, and what to do with it: "new file", "append"… */
    file: z.string().optional(),
    action: z.string().optional(),
    /** Numbered notes on lines of the code: `marks` places each number on its line (from 0). */
    marks: z.array(z.object({ line: z.number(), n: z.number() })).optional(),
    notes: z.array(z.object({ n: z.number(), body: z.array(Prose) })).optional(),
  }),
  /** A boxed aside: a note, a tip or a warning, with an optional title. */
  z.object({
    kind: z.literal("callout"),
    tone: z.enum(["note", "tip", "warning"]),
    title: z.string().optional(),
    body: z.array(Prose),
  }),
  /** The blocks after this one, up to a details-end, fold away under `summary`. */
  z.object({ kind: z.literal("details"), summary: z.string() }),
  z.object({ kind: z.literal("details-end") }),
  z.object({ kind: z.literal("diagram"), text: z.string(), caption: z.string().optional() }),
  z.object({ kind: z.literal("table"), head: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ kind: z.literal("compare"), sides: z.tuple([Side, Side]) }),
  z.object({ kind: z.literal("sequence"), title: z.string(), steps: z.array(Step) }),
]);
export type Block = z.infer<typeof Block>;
export type Step = z.infer<typeof Step>;

export const LessonRef = z.object({
  id: z.string(),
  title: z.string(),
  minutes: z.number(),
  summary: z.string(),
});
export type LessonRef = z.infer<typeof LessonRef>;

/** A page of a tutorial: "intro", "01" … "10", "next-steps", or the second's "2-intro", "2-01" … */
export const TutorialRef = z.object({ id: z.string(), label: z.string(), title: z.string() });
export type TutorialRef = z.infer<typeof TutorialRef>;

/** A page of the reference manual: "index" (its contents), "concepts", "surfaces" … */
export const ReferenceRef = z.object({ id: z.string(), title: z.string() });
export type ReferenceRef = z.infer<typeof ReferenceRef>;

export const Term = z.object({
  term: z.string(),
  aka: z.array(z.string()),
  definition: z.string(),
  lesson: z.string(),
});
export type Term = z.infer<typeof Term>;

// ──────────────────────────────────────────────────────── surfaces

/** A box in the welcome screen's architecture diagram. */
export const ArchNode = z.object({ name: z.string(), role: z.string(), brand: z.boolean().optional() });

/**
 * An arrow between two neighbouring boxes. `forward` points away from the
 * LLM, `back` towards it. Arrows on the same `row` line up across the diagram,
 * so a path that crosses HaiKIT reads as one line.
 */
export const ArchArrow = z.object({
  dir: z.enum(["forward", "back"]),
  channel: z.enum(["model", "ui"]),
  row: z.number(),
  label: z.string(),
});

/** How a HaiKIT app works, as a diagram: three boxes and the labelled arrows between them. */
export const Architecture = z.object({
  caption: z.string(),
  /** The same claim in words, for readers who can't see the drawing. */
  description: z.string(),
  nodes: z.array(ArchNode),
  /** links[i] joins nodes[i] and nodes[i + 1]. */
  links: z.array(z.array(ArchArrow)),
});
export type Architecture = z.infer<typeof Architecture>;

/** A point the welcome screen makes: a short heading, and a sentence or two. */
export const WelcomePoint = z.object({ title: z.string(), text: z.string() });

/**
 * One side of the welcome screen's comparison: software as people drive it
 * today, or as HaiKIT builds it.
 */
export const WelcomeSide = z.object({
  label: z.string(),
  title: z.string(),
  /** Which drawing the browser makes, and the same idea in words for readers who can't see it. */
  image: z.object({ kind: z.enum(["screens", "request"]), alt: z.string() }),
  points: z.array(WelcomePoint),
});

/**
 * A line of a scene, as the person sees it: something that happened in the
 * world, what they typed, what the AI said, an option on screen, or the one
 * they clicked.
 */
export const SceneLine = z.object({ from: z.enum(["world", "you", "ai", "option", "click"]), text: z.string() });

/**
 * A measured example of the two channels: the tokens a result took on screen,
 * beside the tokens the AI read of it.
 */
export const TokenExample = z.object({ name: z.string(), screen: z.number(), model: z.number() });

/**
 * One side of the chatbot comparison: its name, a short tag that labels its
 * cells where the columns stack, and the same request as it plays there.
 */
export const VersusSide = z.object({ name: z.string(), tag: z.string(), scene: z.array(SceneLine) });

// #region welcome
export const welcomeScreen = defineSurface({
  name: "welcome",
  // 2 added the diagram, 3 the sections, 4 their illustrations, 5 a source
  // link, 6 the links list, 7 a tutorial panel of links, 8 the tutorial in-app,
  // 9 the second tutorial beside it, 10 the reference manual under them,
  // 11 the story in place of the sections: today, how, and what you get,
  // 12 a chatbot beside the app against an app the AI runs, after today,
  // 13 how HaiKIT saves tokens, after how it works
  version: 13,
  props: z.object({
    /** A short introduction, one paragraph per entry. The first is the lede; the rest close the screen. */
    intro: z.array(z.string()),
    /** Under the lede: what HaiKIT is, in a sentence or two. */
    summary: z.string(),
    /** Where HaiKIT lives, linked beside the logo: its source and its packages. */
    links: z.array(z.object({ site: z.enum(["github", "npm"]), label: z.string(), url: z.string() })),
    /** First, software as people drive it today, beside software the AI drives. */
    today: z.object({ label: z.string(), title: z.string(), lead: z.string(), before: WelcomeSide, after: WelcomeSide }),
    /**
     * Then a chatbot added beside an app's screens against an app the AI runs:
     * the same request in each, then a row for each difference.
     */
    versus: z.object({
      label: z.string(),
      title: z.string(),
      lead: z.string(),
      chatbot: VersusSide,
      haikit: VersusSide,
      rows: z.array(z.object({ topic: z.string(), chatbot: z.string(), haikit: z.string() })),
    }),
    /** Then how the AI does a job with you: one of HaiKIT's demos, step by step, then how it works underneath. */
    example: z.object({
      label: z.string(),
      title: z.string(),
      lead: z.string(),
      steps: z.array(z.object({ title: z.string(), text: z.string(), scene: z.array(SceneLine) })),
      demo: z.object({ label: z.string(), url: z.string() }),
      underneath: z.object({ title: z.string(), text: z.string(), architecture: Architecture }),
    }),
    /** Then how HaiKIT saves tokens: measured examples, the ways it does, and where to see it on this page. */
    tokens: z.object({
      label: z.string(),
      title: z.string(),
      lead: z.string(),
      examples: z.array(TokenExample),
      points: z.array(WelcomePoint),
      /** Where to watch it happen on this page. */
      see: z.string(),
    }),
    /** Last, what building this way gives each audience: the people who use the software, and the team that builds it. */
    values: z.object({
      label: z.string(),
      title: z.string(),
      lead: z.string(),
      groups: z.array(z.object({ audience: z.string(), points: z.array(WelcomePoint) })),
    }),
    /** HaiKIT's tutorial, built into this app, shown beside the place to start. */
    tutorial: z.object({
      title: z.string(),
      lead: z.string(),
      steps: z.array(TutorialRef),
      /** The tutorial that carries on from this one: its first page, and how many steps it has. */
      next: z.object({ title: z.string(), lead: z.string(), first: TutorialRef, steps: z.number() }).optional(),
    }),
    /** HaiKIT's reference manual, built into this app: every page, its contents first. */
    reference: z.object({ title: z.string(), lead: z.string(), pages: z.array(ReferenceRef) }),
    /** Each part's range of lessons, so the model knows which lessons exist. */
    parts: z.array(
      z.object({ n: z.number(), title: z.string(), first: z.string(), last: z.string(), lessons: z.number(), minutes: z.number() }),
    ),
    first: LessonRef, // where "Start" leads
  }),

  actions: {
    // Its buttons are the question this screen asks: where to begin.
    begin: resolve(z.enum(["first-lesson", "course-map"])),
    tutorial: resolve(z.string()), // or a page of a tutorial, by id
    reference: resolve(z.string()), // or a page of the reference manual, by id
  },
});
// #endregion welcome

// #region course-map
export const courseMap = defineSurface({
  name: "course_map",
  version: 3, // 2 lists the tutorial's pages, 3 both tutorials'
  props: z.object({
    // First array prop on purpose: query_ui reports "N of TOTAL match" using
    // the first array in the props, and the glossary is what gets queried.
    glossary: z.array(Term),
    parts: z.array(
      z.object({ n: z.number(), title: z.string(), blurb: z.string(), lessons: z.array(LessonRef) }),
    ),
    tutorials: z.array(z.object({ title: z.string(), blurb: z.string(), pages: z.array(TutorialRef) })),
  }),

  actions: {
    open: resolve(z.string()), // a lesson id, such as "1.2", or a tutorial page, such as "03" or "2-03"
  },

  queries: {
    glossary: query(
      z.object({ term: z.string().optional() }),
      "Definitions of haikit terms used in the course",
      {
        type: "object",
        properties: { term: { type: "string", description: "e.g. digest, handle, elicit" } },
      },
    ),
  },
});
// #endregion course-map

export const lesson = defineSurface({
  name: "lesson",
  version: 1,
  props: z.object({
    blocks: z.array(Block),
    id: z.string(),
    part: z.object({ n: z.number(), title: z.string() }),
    position: z.object({ index: z.number(), total: z.number() }),
    title: z.string(),
    minutes: z.number(),
    summary: z.string(),
    /** Exactly what the lesson's digest tells the model. */
    takeaways: z.array(z.string()),
    next: LessonRef.nullable(),
  }),

  // No actions: a lesson is something shown, not something asked. Stepping
  // through a diagram or expanding a code block stays in the browser.
  actions: {},

  queries: {
    find: query(
      z.object({ text: z.string() }),
      "Passages of this lesson that mention a word or phrase",
      { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    ),
  },
});

// #region tutorial-step
export const tutorialStep = defineSurface({
  name: "tutorial_step",
  version: 1,
  props: z.object({
    blocks: z.array(Block),
    id: z.string(),
    label: z.string(),
    title: z.string(),
    /** The tutorial's own title, and where this page sits in it. */
    tutorial: z.string(),
    position: z.object({ index: z.number(), total: z.number() }),
    prev: TutorialRef.nullable(),
    next: TutorialRef.nullable(),
  }),

  actions: {
    // Previous, Next or the course map: a page waits for the reader to move on.
    go: resolve(z.string()),
  },

  queries: {
    find: query(
      z.object({ text: z.string() }),
      "Passages of this tutorial page that mention a word or phrase",
      { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    ),
  },
});
// #endregion tutorial-step

export const referencePage = defineSurface({
  name: "reference_page",
  version: 1,
  props: z.object({
    blocks: z.array(Block),
    id: z.string(),
    title: z.string(),
    /** Where this page sits in the manual. */
    position: z.object({ index: z.number(), total: z.number() }),
    prev: ReferenceRef.nullable(),
    next: ReferenceRef.nullable(),
    /** The section to open at, by its anchor, or null for the top. */
    anchor: z.string().nullable(),
  }),
  actions: {
    // A link to another page, or Previous, Next or Contents: a page waits for
    // the reader to move on, like a tutorial page. The value is the link's
    // target, such as "ref:tools#query_ui".
    go: resolve(z.string()),
  },
  queries: {
    find: query(
      z.object({ text: z.string() }),
      "Passages of this reference page that mention a word or phrase, each with its section",
      { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    ),
  },
});

// #region next-lesson
export const nextLesson = defineSurface({
  name: "next_lesson",
  version: 1,
  props: z.object({ next: LessonRef }),

  actions: {
    // The button is the question: the next lesson waits until it's clicked.
    go: resolve(z.enum(["next-lesson", "course-map"])),
  },
});
// #endregion next-lesson

// #region checkpoint
export const checkpoint = defineSurface({
  name: "checkpoint",
  version: 1,
  props: z.object({
    options: z.array(z.object({ id: z.string(), text: z.string() })),
    lessonId: z.string(),
    lessonTitle: z.string(),
    question: z.string(),
    // No `answer` here. Props are what the browser receives, and the answer
    // key stays on the server, where the action handler grades the click.
  }),

  actions: {
    answer: resolve(z.string()), // the id of the option the learner clicked
  },
});
// #endregion checkpoint

export type WelcomeProps = Infer<typeof welcomeScreen.props>;
export type CourseMapProps = Infer<typeof courseMap.props>;
export type LessonProps = Infer<typeof lesson.props>;
export type CheckpointProps = Infer<typeof checkpoint.props>;
export type NextLessonProps = Infer<typeof nextLesson.props>;
export type TutorialStepProps = Infer<typeof tutorialStep.props>;
export type ReferencePageProps = Infer<typeof referencePage.props>;
