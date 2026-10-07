import type { Block } from "../../shared/surfaces.ts";
import type { Selector, Source } from "../excerpts.ts";

/**
 * A lesson as authored. `excerpt` blocks name a file and a selector; the
 * course resolves them into code blocks when the server starts.
 */
export type BlockDef =
  | Block
  | { kind: "excerpt"; file: Source; pick: Selector; lang: "ts" | "js" | "html"; caption?: string };

export interface Check {
  question: string;
  options: string[];
  /** Index into `options`. Server-only: it never reaches the browser. */
  answer: number;
  /** Shown after the learner answers, whichever option they chose. */
  why: string;
}

export interface LessonDef {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  blocks: BlockDef[];
  /** What the model is told about this lesson, and what the learner sees as the recap. */
  takeaways: string[];
  check: Check;
}

export interface PartDef {
  n: number;
  title: string;
  blurb: string;
  lessons: LessonDef[];
}
