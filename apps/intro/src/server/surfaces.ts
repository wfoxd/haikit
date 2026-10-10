import { estTokens, type Cap } from "@haikit/core";
import type { Block, Term } from "../shared/surfaces.ts";
import { checkpoint, courseMap, lesson, nextLesson, tutorialStep, welcomeScreen } from "../shared/surfaces.ts";
import { CHECKS, OPTION_IDS, lessonProps } from "./course/index.ts";
import { tutorialPage } from "./tutorial.ts";

const quote = (s: string) => `"${s}"`;
const letter = (id: string) => id.toUpperCase();

/** Glossary entries matching a term, best match first; no term matches all. */
function lookup(terms: Term[], q: string | undefined): Term[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9_ ]/g, " ").replace(/\s+/g, " ").trim();
  const wanted = norm(q ?? "");
  if (!wanted) return terms;
  const score = (t: Term) => {
    const names = [t.term, ...t.aka].map(norm);
    if (names.includes(wanted)) return 3;
    if (names.some((n) => n.length >= 3 && wanted.includes(n))) return 2;
    if (wanted.length >= 3 && names.some((n) => n.includes(wanted))) return 1;
    return 0;
  };
  return terms
    .map((t) => ({ t, s: score(t) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ t }) => t);
}

// #region welcome-server
export const welcomeServer = welcomeScreen.implement({
  // The screen shows a logo, an introduction, a diagram and three sections.
  // The model gets what it needs to act on the answer: which lessons exist,
  // and what each choice leads to.
  digest(props, { handle }) {
    const parts = props.parts
      .map((p) => `Part ${p.n} ${quote(p.title)}, lessons ${p.first}–${p.last}`)
      .join("; ");
    // Section and point titles, so the model can answer "why HaiKIT?" from
    // what the visitor is looking at.
    const sections = props.sections
      .map((sec) => `${sec.title} (${sec.points.map((p) => p.title).join("; ")})`)
      .join(". ");
    return (
      `Welcome screen on display as ${handle}: the HaiKIT logo, a short introduction, ` +
      `a diagram of how a HaiKIT app works, and three sections: ${sections}. ` +
      `Links shown: ${props.links.map((l) => `${l.label} on ${l.site === "npm" ? "npm" : "GitHub"}, ${l.url}`).join("; ")}. ` +
      `Beside the place to start, HaiKIT's tutorial, built into this app: ${quote(props.tutorial.title)}, ` +
      `steps ${props.tutorial.steps[0]?.id}–${props.tutorial.steps.at(-1)?.id}; show_tutorial_step opens a page ` +
      `(intro, a step, or next-steps). ` +
      (props.tutorial.next
        ? `Then the second tutorial: ${quote(props.tutorial.next.title)}, pages ${props.tutorial.next.first.id} and ` +
          `steps 2-01–2-${String(props.tutorial.next.steps).padStart(2, "0")}, then 2-next-steps. `
        : "") +
      `The course: ${parts}. It asks where to begin: lesson ${props.first.id} ` +
      `${quote(props.first.title)}, or the course map (show_course_map), which lists ` +
      `every lesson and holds the glossary.`
    );
  },

  actions: {
    begin(choice, { props }) {
      return choice === "first-lesson"
        ? `The learner chose to start with lesson ${props.first.id} ${quote(props.first.title)}.`
        : "The learner chose to see the course map.";
    },
    tutorial(id) {
      const page = tutorialPage(id);
      // Throwing refuses the click and leaves the welcome screen live.
      if (!page) throw new Error(`no tutorial page ${id}`);
      return `The learner chose to open tutorial step ${page.id} ${quote(page.title)}.`;
    },
  },

  queries: {},
});
// #endregion welcome-server

export const courseMapServer = courseMap.implement({
  // The model needs the lesson ids to open one, so they're all here. The
  // summaries and the glossary stay in the browser.
  digest(props, { handle }) {
    const lessons = props.parts.reduce((n, p) => n + p.lessons.length, 0);
    const parts = props.parts.map(
      (p) => `Part ${p.n}, ${quote(p.title)}: ${p.lessons.map((l) => `${l.id} ${quote(l.title)}`).join(", ")}.`,
    );
    const tutorials = props.tutorials.map(
      (t, i) => `Tutorial ${i + 1}, ${quote(t.title)}: ${t.pages.map((p) => `${p.id} ${quote(p.title)}`).join(", ")} (show_tutorial_step).`,
    );
    return [
      `Course map: ${props.parts.length} parts, ${lessons} lessons.`,
      ...parts,
      ...tutorials,
      `Glossary of ${props.glossary.length} terms, searchable with query_ui (course_map.glossary).`,
      `Rendered as ${handle}.`,
    ].join(" ");
  },

  actions: {
    open(id, { props }) {
      const found = props.parts.flatMap((p) => p.lessons).find((l) => l.id === id);
      if (found) return `Opened lesson ${found.id} ${quote(found.title)}.`;
      const page = props.tutorials.flatMap((t) => t.pages).find((p) => p.id === id);
      if (page) return `Opened tutorial step ${page.id} ${quote(page.title)}.`;
      // Throwing refuses the click and leaves the map live.
      throw new Error(`no lesson ${id}`);
    },
  },

  // #region glossary-query
  queries: {
    glossary(args, { props, cap }) {
      return cap(
        lookup(props.glossary, args.term),
        (t) => `${t.term} (lesson ${t.lesson}): ${t.definition}`,
        { maxRows: 4 },
      );
    },
  },
  // #endregion glossary-query
});

/** The words in a block, for searching a lesson or a tutorial step. */
export function textOf(block: Block): string {
  const prose = (body: { kind: "p"; text: string } | { kind: "list"; items: string[] }) =>
    body.kind === "p" ? body.text : body.items.join(" ");
  switch (block.kind) {
    case "p":
    case "h":
    case "note":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "code":
      return [
        block.file,
        block.caption,
        block.code,
        ...(block.notes ?? []).flatMap((n) => n.body.map(prose)),
      ].filter(Boolean).join(" ");
    case "diagram":
      return block.text;
    case "table":
      return [block.head, ...block.rows].flat().join(" ");
    case "compare":
      return block.sides.map((s) => `${s.title}: ${s.text}`).join(" ");
    case "sequence":
      return block.steps.map((s) => `${s.label}: ${s.note}`).join(" ");
    case "callout":
      return [block.title ?? "", ...block.body.map(prose)].join(" ");
    case "details":
      return block.summary;
    case "details-end":
      return "";
  }
}

/** Passages of a page's blocks that mention `wanted`, capped. */
function findIn(blocks: Block[], wanted: string, cap: Cap) {
  const hits = blocks.map(textOf).filter((t) => t.toLowerCase().includes(wanted.toLowerCase()));
  return cap(hits, (t) => (t.length > 240 ? `${t.slice(0, 239)}…` : t), { maxRows: 3 });
}

export const lessonServer = lesson.implement({
  // The takeaways are the whole of what the model learns about a lesson. The
  // browser shows them as the lesson's recap, so the learner sees it too.
  digest(props, { handle }) {
    const where = `part ${props.part.n}, lesson ${props.position.index} of ${props.position.total}`;
    return [
      `Lesson ${props.id} ${quote(props.title)} is on screen as ${handle} (${where};`,
      `about ${estTokens(props).toLocaleString("en")} tokens that stay in the browser).`,
      `Takeaways: ${props.takeaways.map((t, i) => `(${i + 1}) ${t}`).join(" ")}`,
      props.next
        ? `Next lesson: ${props.next.id} ${quote(props.next.title)}.`
        : "This is the last lesson so far.",
    ].join(" ");
  },

  actions: {},

  queries: {
    find(args, { props, cap }) {
      return findIn(props.blocks, args.text, cap);
    },
  },
});

export const nextLessonServer = nextLesson.implement({
  digest(props, { handle }) {
    return (
      `Up next, on display as ${handle}: lesson ${props.next.id} ${quote(props.next.title)}. ` +
      `The learner continues by clicking it, or opens the course map instead. Don't show the ` +
      `lesson before they click.`
    );
  },

  actions: {
    go(choice, { props }) {
      return choice === "next-lesson"
        ? `The learner chose to continue to lesson ${props.next.id} ${quote(props.next.title)}.`
        : "The learner chose to see the course map.";
    },
  },

  queries: {},
});

// #region tutorial-step-server
export const tutorialStepServer = tutorialStep.implement({
  // The page itself (often hundreds of lines of code and notes) stays in the
  // browser. The model gets how it opens, the files it touches, what's next,
  // and a query for anything else.
  digest(props, { handle }) {
    const lead = props.blocks.find((b) => b.kind === "p")?.text ?? "";
    const files = [
      ...new Set(
        props.blocks.flatMap((b) =>
          b.kind === "code" && b.file && !/^(terminal|tool_result)$/.test(b.file) ? [b.file] : [],
        ),
      ),
    ];
    return [
      `Tutorial page ${props.id} ${quote(props.title)}, of ${quote(props.tutorial)}, is on screen as ${handle}`,
      `(page ${props.position.index} of ${props.position.total}; about ${estTokens(props).toLocaleString("en")} tokens that stay in the browser).`,
      lead ? `It opens: ${lead.length > 220 ? `${lead.slice(0, 219)}…` : lead}` : "",
      files.length ? `Files: ${files.join(", ")}.` : "",
      props.next ? `Next: tutorial step ${props.next.id} ${quote(props.next.title)}.` : "It is the last page of the tutorials.",
      "The reader moves on with its buttons; query_ui find answers questions about it.",
    ]
      .filter(Boolean)
      .join(" ");
  },

  actions: {
    // Only the pages this one offers, or the course map: the buttons are the allowlist.
    go(target, { props }) {
      if (target === "course-map") return "The reader chose to see the course map.";
      const page = [props.prev, props.next].find((p) => p?.id === target);
      if (!page) throw new Error(`no way from ${props.id} to ${target}`);
      return `The reader moved to tutorial step ${page.id} ${quote(page.title)}.`;
    },
  },

  queries: {
    find(args, { props, cap }) {
      return findIn(props.blocks, args.text, cap);
    },
  },
});
// #endregion tutorial-step-server

// #region checkpoint-server
export const checkpointServer = checkpoint.implement({
  digest(props, { handle }) {
    const options = props.options.map((o) => `${letter(o.id)}) ${o.text}`).join("; ");
    return (
      `Checkpoint for lesson ${props.lessonId}, on screen as ${handle}: ${quote(props.question)} ` +
      `Options: ${options}. The learner answers by clicking; the answer key stays on the server.`
    );
  },

  actions: {
    answer(optionId, { props }) {
      const check = CHECKS.get(props.lessonId);
      const chosen = props.options.find((o) => o.id === optionId);
      // Throwing refuses the click: nothing is recorded, the surface stays live.
      if (!check || !chosen) throw new Error(`no option ${optionId} on checkpoint ${props.lessonId}`);

      const right = OPTION_IDS[check.answer];
      const next = lessonProps(props.lessonId)?.next;
      return [
        `Answered checkpoint ${props.lessonId} with ${letter(optionId)}: ${quote(chosen.text)}.`,
        optionId === right
          ? "Correct."
          : `Not quite: the answer is ${letter(right)}, ${quote(check.options[check.answer])}.`,
        `Why: ${check.why}`,
        next ? `Next lesson: ${next.id} ${quote(next.title)}.` : "Next lesson: none, that was the last one so far.",
      ].join(" ");
    },
  },

  queries: {},
});
// #endregion checkpoint-server
