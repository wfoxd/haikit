/**
 * What haikit refuses to compile, shown against this introduction's own surfaces.
 *
 * Never run, only typechecked: `npm run typecheck` compiles it with the rest
 * of the app. Every line marked @ts-expect-error has to fail to compile, and
 * TypeScript reports a marker on a line that compiles. So if a haikit release
 * ever loosened one of these guarantees, this introduction would stop building.
 *
 * Lesson 2.7 quotes the regions below.
 */

import type { ToolCtx } from "@haikit/core";
import { checkpoint, courseMap, type LessonProps } from "../src/shared/surfaces.ts";
import { lessonServer } from "../src/server/surfaces.ts";

declare const ctx: ToolCtx;
declare const props: LessonProps;

// #region no-digest
// @ts-expect-error  Property 'digest' is missing
checkpoint.implement({
  actions: { answer: () => "Answered." },
  queries: {},
});
// #endregion no-digest

// #region uncapped
courseMap.implement({
  digest: () => "Course map.",
  actions: { open: () => "Opened." },
  queries: {
    // @ts-expect-error  raw rows are not Capped: only cap() builds a result
    glossary: (_args, { props }) => props.glossary,
  },
});
// #endregion uncapped

// #region elicit-without-resolve
export async function askWithALesson() {
  // @ts-expect-error  lesson declares no resolve action, so nothing could answer
  await ctx.render(lessonServer, props, { mode: "elicit" });
}
// #endregion elicit-without-resolve

// #region undeclared-action
checkpoint.implement({
  digest: () => "Checkpoint.",
  // @ts-expect-error  'reveal' is not declared in the contract
  actions: { answer: () => "Answered.", reveal: () => "The answer is B." },
  queries: {},
});
// #endregion undeclared-action
