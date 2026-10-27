import { defineTool } from "@haikit/core";
import { z } from "zod";
import { checkpointProps, courseMapProps, lessonIds, lessonProps, lessonRef, welcomeProps } from "./course/index.ts";
import { REFERENCE, referencePageOf, referenceRefs } from "./reference.ts";
import {
  checkpointServer,
  courseMapServer,
  lessonServer,
  nextLessonServer,
  referencePageServer,
  tutorialStepServer,
  welcomeServer,
} from "./surfaces.ts";
import { tutorialOf, tutorialRefs } from "./tutorial.ts";

const LessonInput = z.object({ id: z.string() });
const lessonInputSchema = {
  type: "object",
  properties: { id: { type: "string", description: "A lesson id from the course map, such as 1.2" } },
  required: ["id"],
  additionalProperties: false,
};
const unknown = (id: string) => `No lesson ${id}. Lessons: ${lessonIds().join(", ")}.`;

// #region lesson-tools
export const showLesson = defineTool({
  name: "show_lesson",
  description:
    "Show a lesson. Display-only: it does not block. Always call ask_checkpoint " +
    "for the same lesson in the same reply.",
  input: LessonInput,
  inputJsonSchema: lessonInputSchema,

  async run({ id }, ctx) {
    const props = lessonProps(id);
    if (!props) return ctx.text(unknown(id));
    return ctx.render(lessonServer, props); // display: returns the digest now
  },
});

export const askCheckpoint = defineTool({
  name: "ask_checkpoint",
  description:
    "Ask the lesson's checkpoint question. BLOCKS until the learner clicks an " +
    "answer; the UI is the question, so don't also ask it in text.",
  input: LessonInput,
  inputJsonSchema: lessonInputSchema,

  async run({ id }, ctx) {
    const props = checkpointProps(id);
    if (!props) return ctx.text(unknown(id));
    return ctx.render(checkpointServer, props, { mode: "elicit" }); // parks the turn
  },
});
// #endregion lesson-tools

const NoInput = z.object({});
const noInputSchema = { type: "object", properties: {}, additionalProperties: false };

// #region welcome
// Passed to createHai as `init`, so it runs when the conversation starts,
// before the model's first turn.
export const welcome = defineTool({
  name: "welcome",
  description:
    "Show the welcome screen: the HaiKIT logo and a short introduction. BLOCKS " +
    "until the learner chooses where to begin.",
  input: NoInput,
  inputJsonSchema: noInputSchema,

  async run(_input, ctx) {
    return ctx.render(welcomeServer, welcomeProps(), { mode: "elicit" });
  },
});
// #endregion welcome

/** The model can't call init again, so showing the welcome later is its own tool. */
export const showWelcome = defineTool({
  name: "show_welcome",
  description:
    "Show the welcome screen again: the HaiKIT logo, the introduction, and where to begin. " +
    "BLOCKS until the learner chooses.",
  input: NoInput,
  inputJsonSchema: noInputSchema,

  async run(_input, ctx) {
    return ctx.render(welcomeServer, welcomeProps(), { mode: "elicit" });
  },
});

// #region course-map-tool
export const showCourseMap = defineTool({
  name: "show_course_map",
  description:
    "Show the course map: every part and lesson, and the glossary. BLOCKS " +
    "until the learner picks a lesson.",
  input: NoInput,
  inputJsonSchema: noInputSchema,

  async run(_input, ctx) {
    return ctx.render(courseMapServer, courseMapProps(), { mode: "elicit" });
  },
});
// #endregion course-map-tool

// After a checkpoint is answered, the next lesson waits for the learner: a
// button they click when they're ready, not a lesson pushed at them.
export const offerNextLesson = defineTool({
  name: "offer_next_lesson",
  description:
    "After a checkpoint is answered, show a button to continue to the next lesson. " +
    "BLOCKS until the learner clicks it. Don't show the next lesson in the same reply.",
  input: LessonInput,
  inputJsonSchema: lessonInputSchema,

  async run({ id }, ctx) {
    const next = lessonRef(id);
    if (!next) return ctx.text(unknown(id));
    return ctx.render(nextLessonServer, { next }, { mode: "elicit" });
  },
});

// #region tutorial-tool
export const showTutorialStep = defineTool({
  name: "show_tutorial_step",
  description:
    "Show a page of HaiKIT's tutorials, built into this app. The first, building a Hello, World! app: " +
    "intro, a step from 01 to 10, or next-steps. The second, on notifications: 2-intro, a step from " +
    "2-01 to 2-09, or 2-next-steps. The third, on signing people in: 3-intro, a step from 3-01 to 3-10, " +
    "or 3-next-steps. BLOCKS until the reader clicks Previous, Next or Course map on it.",
  input: z.object({ id: z.string() }),
  inputJsonSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "intro, 01 … 10, next-steps; 2-intro, 2-01 … 2-09, 2-next-steps; or 3-intro, 3-01 … 3-10, 3-next-steps" },
    },
    required: ["id"],
    additionalProperties: false,
  },

  async run({ id }, ctx) {
    // Previous and Next read on from one tutorial into the next.
    const refs = tutorialRefs();
    const at = refs.findIndex((r) => r.id === id);
    const tutorial = tutorialOf(id);
    if (at < 0 || !tutorial) return ctx.text(`No tutorial page ${id}. Pages: ${refs.map((r) => r.id).join(", ")}.`);
    const index = tutorial.pages.findIndex((p) => p.id === id);
    const page = tutorial.pages[index]!;
    return ctx.render(
      tutorialStepServer,
      {
        blocks: page.blocks,
        id: page.id,
        label: page.label,
        title: page.title,
        tutorial: tutorial.title,
        position: { index: index + 1, total: tutorial.pages.length },
        prev: refs[at - 1] ?? null,
        next: refs[at + 1] ?? null,
      },
      { mode: "elicit" }, // its Previous / Next buttons are the question
    );
  },
});
// #endregion tutorial-tool

const pageIds = REFERENCE.map((p) => p.id).join(", ");

export const showReferencePage = defineTool({
  name: "show_reference_page",
  description:
    `Show a page of HaiKIT's reference manual, built into this app: ${pageIds}. index is its contents, ` +
    "and its symbol index names the page that documents each export. Pass anchor to open the page at a " +
    "section, such as freshness on surfaces. BLOCKS until the reader clicks a link to another page, or " +
    "Previous, Next or Contents on it.",
  input: z.object({ page: z.string(), anchor: z.string().optional() }),
  inputJsonSchema: {
    type: "object",
    properties: {
      page: { type: "string", description: pageIds },
      anchor: { type: "string", description: "A section's anchor on that page, as the manual's links write it, such as freshness" },
    },
    required: ["page"],
    additionalProperties: false,
  },

  async run({ page: id, anchor }, ctx) {
    const page = referencePageOf(id);
    if (!page) return ctx.text(`No reference page ${id}. Pages: ${pageIds}.`);
    const wanted = anchor?.replace(/^#/, "") || null;
    if (wanted && !page.anchors.has(wanted)) {
      return ctx.text(`No section #${wanted} on reference page ${id}. Its sections: ${[...page.anchors.keys()].join(", ")}.`);
    }
    const refs = referenceRefs();
    const at = refs.findIndex((r) => r.id === id);
    return ctx.render(
      referencePageServer,
      {
        blocks: page.blocks,
        id: page.id,
        title: page.title,
        position: { index: at + 1, total: refs.length },
        prev: refs[at - 1] ?? null,
        next: refs[at + 1] ?? null,
        anchor: wanted,
      },
      { mode: "elicit" }, // its links and buttons are the question
    );
  },
});

export const tools = [showLesson, askCheckpoint, offerNextLesson, showCourseMap, showTutorialStep, showReferencePage, showWelcome];
