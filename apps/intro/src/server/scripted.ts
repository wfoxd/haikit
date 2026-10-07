/**
 * The scripted guide: a ModelAdapter that needs no API key, so the course can
 * be deployed and taken by anyone without a model bill.
 *
 * It lives in the app, not the framework, which is the point of the adapter
 * seam: `generate` is one method, and the runtime can't tell this from Claude.
 *
 * It holds to the same discipline the course teaches. It never imports the
 * course content: it knows which lessons exist only because the welcome
 * screen's digest gives each part's range, and every fact it states is lifted
 * from a digest or a tool result, exactly what a real model would have seen.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `toolu_guide${++counter}`,
  name,
  input,
});

const pause = () => new Promise((r) => setTimeout(r, 14));

/** Stream the text a word at a time, then return it with any tool calls. */
async function reply(
  text: string,
  onTextDelta: (t: string) => void,
  calls: ReturnType<typeof toolUse>[] = [],
): Promise<ModelResponse> {
  for (const word of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(word);
    await pause();
  }
  return {
    content: [{ type: "text", text }, ...calls],
    stop_reason: calls.length ? "tool_use" : "end_turn",
  };
}

/** What the guide can know, read from the history the way a model reads it. */
function read(messages: ModelRequest["messages"]) {
  const blocks = messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as any[]) : []));
  const results: string[] = blocks
    .filter((b) => b?.type === "tool_result")
    .map((b) => String(b.content));

  const all = results.join("\n");

  // Which lessons exist: the welcome digest gives each part's range, such as
  // "lessons 1.1–1.6", and the course map's digest names every lesson.
  const ids = new Set<string>();
  for (const [, part, from, to] of all.matchAll(/lessons (\d+)\.(\d+)–\d+\.(\d+)/g)) {
    for (let i = Number(from); i <= Number(to); i++) ids.add(`${part}.${i}`);
  }
  // Titles, from wherever a lesson was named: a digest, or a click's result.
  const titles = new Map<string, string>();
  for (const [, id, title] of all.matchAll(/(\d+\.\d+) "([^"]+)"/g)) {
    ids.add(id!);
    titles.set(id!, title!);
  }
  const order = (id: string) => id.split(".").map(Number) as [number, number];
  const lessons = [...ids]
    .sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
    .map((id) => ({ id, title: titles.get(id) }));

  // the glossary lives on the course map, once one has been shown
  const map = results.find((r) => r.startsWith("Course map:")) ?? "";
  const mapHandle = map.match(/Rendered as (ui_\d+)/)?.[1];

  // the lesson the guide showed most recently
  const uses = blocks.filter((b) => b?.type === "tool_use");
  const shown = uses.filter((b) => b.name === "show_lesson").at(-1);
  const current = lessons.find((l) => l.id === shown?.input?.id) ?? null;

  // The tutorial's pages, in order: the welcome digest gives its steps as a
  // range, such as "steps 01–10", around an intro and next-steps.
  const range = all.match(/built into this app: "[^"]+", steps (\d+)–(\d+)/);
  const pages = range
    ? ["intro", ...Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) =>
        String(Number(range[1]) + i).padStart(2, "0")), "next-steps"]
    : [];
  // The tutorial page on screen, if one was shown after the last lesson.
  const lastUse = (name: string) => uses.findLastIndex((b) => b.name === name);
  const page =
    lastUse("show_tutorial_step") > lastUse("show_lesson")
      ? (uses[lastUse("show_tutorial_step")]?.input?.id as string | undefined) ?? null
      : null;

  return { lessons, mapHandle, current, pages, page };
}

export function scripted(): ModelAdapter {
  return {
    id: "scripted guide",

    async generate({ messages, onTextDelta }: ModelRequest): Promise<ModelResponse> {
      const { lessons, mapHandle, current, pages, page } = read(messages);
      const find = (id: string) => lessons.find((l) => l.id === id);
      const after = (id: string | undefined) => lessons[lessons.findIndex((l) => l.id === id) + 1];

      /** A lesson and its checkpoint, in one reply: display, then elicit. */
      const teach = (l: { id: string; title?: string | undefined }, lead = "Lesson ") =>
        reply(
          `${lead}${l.id}${l.title ? `: ${l.title}` : ""}. Read it through, then answer the checkpoint underneath.`,
          onTextDelta,
          [toolUse("show_lesson", { id: l.id }), toolUse("ask_checkpoint", { id: l.id })],
        );
      const courseMap = (text: string) => reply(text, onTextDelta, [toolUse("show_course_map", {})]);

      /** A page of the tutorial, which waits for the reader's Previous or Next. */
      const tour = (id: string, title?: string) =>
        reply(
          id === "intro"
            ? "Here's the tutorial: what you'll build, and why. Use Next at the bottom when you're ready."
            : id === "next-steps"
              ? "The tutorial's last page: where to go from here."
              : `Tutorial step ${id}${title ? `: ${title}` : ""}. Use Next at the bottom when you're ready.`,
          onTextDelta,
          [toolUse("show_tutorial_step", { id })],
        );

      const last = messages.at(-1);
      const latest = Array.isArray(last?.content)
        ? (last.content as any[]).filter((b) => b?.type === "tool_result").map((b) => String(b.content))
        : [];

      // ── reacting to tool results ───────────────────────────────────
      if (latest.length) {
        // A checkpoint was answered. The grade, the reason and what comes
        // next all arrive in the click's tool result.
        const answered = latest.find((r) => r.includes("Answered checkpoint"));
        if (answered) {
          const verdict = answered.includes(" Correct.")
            ? "Correct."
            : `Not quite: ${answered.match(/Not quite: (.*?")\./)?.[1] ?? "see the explanation"}.`;
          const why = answered.match(/Why: (.*?) Next lesson:/s)?.[1] ?? "";
          const next = answered.match(/Next lesson: (\d+\.\d+) "([^"]+)"/);
          const feedback = `${verdict} ${why}\n\n`;
          // The next lesson waits for the learner: offer it, don't show it.
          if (next) {
            return reply(`${feedback}When you're ready, continue to lesson ${next[1]}.`, onTextDelta, [
              toolUse("offer_next_lesson", { id: next[1]! }),
            ]);
          }
          return courseMap(
            `${feedback}That was the last lesson so far. Here's the course map if you'd like to go back to one.`,
          );
        }

        // A button was clicked: the welcome's start, or "continue" after a
        // checkpoint. Either names the lesson to teach.
        const start = latest.join("\n").match(/chose to (?:start with|continue to) lesson (\d+\.\d+) "([^"]+)"/);
        if (start) return teach({ id: start[1]!, title: start[2]! }, "Here's lesson ");
        if (latest.some((r) => r.includes("chose to see the course map"))) {
          return courseMap("Here's the course map. Pick any lesson to open it.");
        }

        // A way into the tutorial: the welcome's panel, the map, or a page's
        // Previous and Next.
        const step = latest.join("\n").match(/(?:chose to open|moved to|Opened) tutorial step ([\w-]+) "([^"]+)"/);
        if (step) return tour(step[1]!, step[2]!);

        const opened = latest.join("\n").match(/Opened lesson (\d+\.\d+) "([^"]+)"/);
        if (opened) return teach({ id: opened[1]!, title: opened[2]! });

        // A query_ui lookup came back, already capped.
        const found = latest.find((r) => /^\d+ of \d+ match/.test(r));
        if (found) {
          if (found.startsWith("0 of")) {
            return reply(
              "The glossary has no entry for that. Try a term from the lessons, such as digest, handle, elicit or cap.",
              onTextDelta,
            );
          }
          const [head, ...rows] = found.split("\n");
          const omitted = head!.match(/(\d+) omitted/)?.[1];
          const more = omitted ? `\n\n(${omitted} more matched; ask about one of them by name.)` : "";
          const back = current ? `\n\nSay “retry” to bring back the ${current.id} checkpoint, or “next” to move on.` : "";
          return reply(`From the course glossary:\n\n${rows.join("\n\n")}${more}${back}`, onTextDelta);
        }

        return reply(latest.at(-1)!.split("\n").at(-1) ?? "Done.", onTextDelta);
      }

      // ── reacting to what the learner typed ─────────────────────────
      const text = (typeof last?.content === "string" ? last.content : "").toLowerCase();

      const id = text.match(/\b(\d+)\.(\d+)\b/)?.[0];
      if (id) {
        const l = find(id);
        return l
          ? teach(l)
          : reply(`There's no lesson ${id}. The lessons are ${lessons.map((x) => x.id).join(", ")}.`, onTextDelta);
      }

      // The tutorial, before the keyword rules: "start the tutorial" is about
      // the tutorial, and "next" means the next page while one is on screen.
      const stepAsked = text.match(/\bstep (\d{1,2})\b/)?.[1];
      if (stepAsked) {
        const want = stepAsked.padStart(2, "0");
        return pages.includes(want)
          ? tour(want)
          : reply(`There's no step ${stepAsked}. The tutorial has steps ${pages.slice(1, -1).join(", ")}.`, onTextDelta);
      }
      if (/\btutorial\b/.test(text) && pages.length) return tour("intro");
      if (page && /\b(next|continue|go on|keep going|move on)\b/.test(text)) {
        const next = pages[pages.indexOf(page) + 1];
        return next ? tour(next) : courseMap("That was the tutorial's last page. Here's the course map.");
      }
      if (page && /\b(back|previous|prev)\b/.test(text)) {
        const prev = pages[pages.indexOf(page) - 1];
        return prev ? tour(prev) : tour(page);
      }

      // the header menu's Home: the welcome screen, shown again
      if (/\b(welcome|home)\b/.test(text)) {
        return reply("Here's the welcome screen.", onTextDelta, [toolUse("show_welcome", {})]);
      }

      if (/\b(contents|map|menu|overview|syllabus|outline|lessons|start over)\b/.test(text)) {
        return courseMap("Here's the course map. Pick a lesson to open it.");
      }

      const part = text.match(/\bpart (\d+|one|two)\b/)?.[1];
      if (part) {
        const n = { one: "1", two: "2" }[part] ?? part;
        const l = lessons.find((x) => x.id.startsWith(`${n}.`));
        return l ? teach(l) : reply(`There's no part ${n} yet.`, onTextDelta);
      }

      if (/\b(retry|again|repeat|re-?ask)\b/.test(text) && current) {
        return reply(`Here's the ${current.id} checkpoint again.`, onTextDelta, [
          toolUse("ask_checkpoint", { id: current.id }),
        ]);
      }

      if (/\b(next|continue|go on|skip|keep going|move on)\b/.test(text)) {
        const l = current ? after(current.id) : lessons[0];
        return l ? teach(l) : courseMap("That was the last lesson so far. Here's the course map.");
      }

      if (/\b(begin|beginning|first|from the top|start)\b/.test(text) && lessons[0]) {
        return teach(lessons[0], "From the beginning: lesson ");
      }

      // A definition: look it up in the glossary the course map carries,
      // through the handle in its digest. Never from memory.
      const term = text
        .match(/(?:what(?:'s| is| are| does)|define|meaning of|explain|tell me about|glossary)\s+(.+)/)?.[1]
        ?.replace(/\b(a|an|the|mean|means|do|does|is|in haikit)\b/g, " ")
        .replace(/[?.!“”"]/g, " ")
        .trim();
      if (term && mapHandle) {
        return reply(`Looking up “${term}” in the course glossary.`, onTextDelta, [
          toolUse("query_ui", { handle: mapHandle, query: "glossary", args: { term } }),
        ]);
      }
      // No map yet means no handle to look it up through, so show the map
      // first. Its glossary is right there, and the next ask can query it.
      if (term) {
        return courseMap(
          `The glossary is part of the course map, so here it is: open Glossary at the bottom, ` +
            `or ask me again and I'll look up “${term}” for you.`,
        );
      }

      return reply(
        "I'm the scripted guide, so I understand a few kinds of request: a lesson (“1.3”, “next”, “part 2”), " +
          "the tutorial (“tutorial”, “step 4”), the course map (“contents”), or a definition (“what is a handle?”). " +
          "Set ANTHROPIC_API_KEY on the server to talk to Claude instead.",
        onTextDelta,
      );
    },
  };
}
