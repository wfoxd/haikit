/**
 * The contract for the course's three surfaces. Both halves import this file:
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
 * One piece of a lesson or a tutorial step. Text fields allow `code`, **bold**
 * and *italic* inline; the browser turns those into elements, never into HTML.
 */
export const Block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("p"), text: z.string() }),
  z.object({ kind: z.literal("h"), text: z.string() }),
  z.object({ kind: z.literal("list"), items: z.array(z.string()) }),
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

/** A page of the tutorial: "intro", "01" … "10", "next-steps". */
export const TutorialRef = z.object({ id: z.string(), label: z.string(), title: z.string() });
export type TutorialRef = z.infer<typeof TutorialRef>;

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

/** A section of the welcome screen: a heading, a short lead, an illustration, and its points. */
export const WelcomeSection = z.object({
  title: z.string(),
  lead: z.string(),
  /** Which drawing the browser makes, and the same idea in words for readers who can't see it. */
  image: z.object({ kind: z.enum(["payload-split", "llm-flow", "contract-split"]), alt: z.string() }),
  points: z.array(z.object({ title: z.string(), text: z.string() })),
});

// #region welcome
export const welcomeScreen = defineSurface({
  name: "welcome",
  // 2 added the diagram, 3 the sections, 4 their illustrations, 5 a source
  // link, 6 the links list, 7 a tutorial panel of links, 8 the tutorial in-app
  version: 8,
  props: z.object({
    /** A short introduction, one paragraph per entry. The first is the lede. */
    intro: z.array(z.string()),
    /** Where HaiKIT lives, linked beside the logo: its source and its packages. */
    links: z.array(z.object({ site: z.enum(["github", "npm"]), label: z.string(), url: z.string() })),
    /** How a HaiKIT app works, drawn under the lede. */
    architecture: z.object({
      caption: z.string(),
      /** The same claim in words, for readers who can't see the drawing. */
      description: z.string(),
      nodes: z.array(ArchNode),
      /** links[i] joins nodes[i] and nodes[i + 1]. */
      links: z.array(z.array(ArchArrow)),
    }),
    /** Why HaiKIT, for the people deciding; what the LLM brings; what HaiKIT gives you. */
    sections: z.array(WelcomeSection),
    /** HaiKIT's tutorial, built into this app, shown beside the place to start. */
    tutorial: z.object({ title: z.string(), lead: z.string(), steps: z.array(TutorialRef) }),
    /** Each part's range of lessons, so the model knows which lessons exist. */
    parts: z.array(
      z.object({ n: z.number(), title: z.string(), first: z.string(), last: z.string(), lessons: z.number(), minutes: z.number() }),
    ),
    first: LessonRef, // where "Start" leads
  }),

  actions: {
    // Its buttons are the question this screen asks: where to begin.
    begin: resolve(z.enum(["first-lesson", "course-map"])),
    tutorial: resolve(z.string()), // or a page of the tutorial, by id
  },
});
// #endregion welcome

// #region course-map
export const courseMap = defineSurface({
  name: "course_map",
  version: 2, // 2 lists the tutorial's pages
  props: z.object({
    // First array prop on purpose: query_ui reports "N of TOTAL match" using
    // the first array in the props, and the glossary is what gets queried.
    glossary: z.array(Term),
    parts: z.array(
      z.object({ n: z.number(), title: z.string(), blurb: z.string(), lessons: z.array(LessonRef) }),
    ),
    tutorial: z.object({ title: z.string(), pages: z.array(TutorialRef) }),
  }),

  actions: {
    open: resolve(z.string()), // a lesson id, such as "1.2", or a tutorial page, such as "03"
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
