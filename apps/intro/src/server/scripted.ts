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

/** What the guide can know, read from the history and the tools the way a model reads them. */
function read(messages: ModelRequest["messages"], system = "", tools: ModelRequest["tools"] = []) {
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

  // The tutorials' pages, in reading order: each one's steps as a range,
  // such as "01 to 10", around an intro and next-steps. A later tutorial's
  // ids carry its number, as "2-" or "3-".
  const span = (prefix: string, from: string, to: string) => [
    `${prefix}intro`,
    ...Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `${prefix}${String(Number(from) + i).padStart(2, "0")}`),
    `${prefix}next-steps`,
  ];
  // Today's system prompt lists them, and comes first: a conversation saved
  // before a step was added has a welcome digest that stops short of it, and
  // one saved before a tutorial, none of it. The digest is for a prompt without.
  const range =
    system.match(/\(intro, (\d+) to (\d+), next-steps\)/) ?? all.match(/built into this app: "[^"]+", steps (\d+)–(\d+)/);
  const later = (n: number) =>
    system.match(new RegExp(`\\(${n}-intro, ${n}-(\\d+) to ${n}-(\\d+), ${n}-next-steps\\)`)) ??
    all.match(new RegExp(`Then the \\w+ tutorial: "[^"]+", pages ${n}-intro and steps ${n}-(\\d+)–${n}-(\\d+)`));
  const pages = [
    ...(range ? span("", range[1]!, range[2]!) : []),
    ...[2, 3].flatMap((n) => {
      const found = later(n);
      return found ? span(`${n}-`, found[1]!, found[2]!) : [];
    }),
  ];
  // The tutorial page on screen, if one was shown after the last lesson.
  const lastUse = (name: string) => uses.findLastIndex((b) => b.name === name);
  const page =
    lastUse("show_tutorial_step") > lastUse("show_lesson")
      ? (uses[lastUse("show_tutorial_step")]?.input?.id as string | undefined) ?? null
      : null;

  // The reference manual's pages: the welcome digest lists them, and a
  // conversation saved before the manual was built in finds them in the
  // description of today's show_reference_page instead.
  const described = tools.find((t) => t.name === "show_reference_page")?.description ?? "";
  const manual =
    all.match(/built into this app: \d+ pages, ([^;]+); show_reference_page/)?.[1] ??
    described.match(/reference manual, built into this app: ([\w, -]+)\./)?.[1] ??
    "";
  const reference = manual.split(/,\s*/).map((p) => p.replace(/ \(.*\)$/, "").trim()).filter(Boolean);

  return { lessons, mapHandle, current, pages, page, reference };
}

export function scripted(): ModelAdapter {
  return {
    id: "scripted guide",

    async generate({ messages, system, tools, onTextDelta }: ModelRequest): Promise<ModelResponse> {
      const { lessons, mapHandle, current, pages, page, reference } = read(messages, system, tools);
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
            : id === "2-intro"
              ? "Here's the second tutorial: the same app, taught to speak up after the request is over. Use Next at the bottom when you're ready."
              : id === "3-intro"
                ? "Here's the third tutorial: the same app, signed in, so each person sees only their own conversations. Use Next at the bottom when you're ready."
                : /^(\d+-)?next-steps$/.test(id)
                  ? "The tutorial's last page: where to go from here."
                  : `Tutorial step ${id}${title ? `: ${title}` : ""}. Use Next at the bottom when you're ready.`,
          onTextDelta,
          [toolUse("show_tutorial_step", { id })],
        );

      /** A page of the reference manual, which waits for the reader's link or button. */
      const look = (id: string, title?: string, anchor?: string, section?: string) =>
        reply(
          id === "index"
            ? "Here's the reference manual's contents. Its links open any page of it, right here."
            : `Reference: ${title ?? id}${section ? `, at “${section}”` : anchor ? `, at #${anchor}` : ""}. ` +
                "Its links, and the buttons at the bottom, take you on.",
          onTextDelta,
          [toolUse("show_reference_page", anchor ? { page: id, anchor } : { page: id })],
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

        // A way into the reference: the welcome's panel, or a page's link or button.
        const ref = latest.join("\n").match(/(?:chose to open|moved to) reference page ([\w-]+) "([^"]+)"(?: at #([\w-]+) "([^"]+)")?/);
        if (ref) return look(ref[1]!, ref[2]!, ref[3], ref[4]);

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

      // The reference manual, before the keyword rules: the contents rail says
      // "Open reference page surfaces", and "contents" alone means the course map.
      const asked = text.match(/\breference page ([\w-]+)(?: at #?([\w-]+))?/);
      if (asked) {
        return reference.includes(asked[1]!)
          ? look(asked[1]!, undefined, asked[2])
          : reply(`There's no reference page ${asked[1]}. Its pages are ${reference.join(", ")}.`, onTextDelta);
      }
      if (/\b(reference|manual)\b/.test(text) && reference.length) return look("index");

      // The tutorial, before the keyword rules: "start the tutorial" is about
      // the tutorial, and "next" means the next page while one is on screen.
      // The contents rail names a page around the steps by its id: "tutorial page 3-intro"
      const pageAsked = text.match(/\btutorial page ((?:[23]-)?(?:intro|next-steps))\b/)?.[1];
      if (pageAsked && pages.includes(pageAsked)) return tour(pageAsked);
      // "step 4" is the first tutorial's; "step 2-03" the second's, "step 3-03" the third's
      const stepAsked = text.match(/\bstep ([23]-\d{1,2}|\d{1,2})\b/)?.[1];
      if (stepAsked) {
        const [, prefix = "", n] = stepAsked.match(/^([23]-)?(\d+)$/)!;
        const want = prefix + n!.padStart(2, "0");
        const steps = pages.filter((p) => /^([23]-)?\d+$/.test(p));
        return pages.includes(want)
          ? tour(want)
          : reply(`There's no step ${stepAsked}. The tutorials have steps ${steps.join(", ")}.`, onTextDelta);
      }
      if (/\b(tutorial 2|second tutorial|notifications? tutorial)\b/.test(text) && pages.includes("2-intro")) return tour("2-intro");
      if (/\b(tutorial 3|third tutorial|sign-?in tutorial|auth tutorial)\b/.test(text) && pages.includes("3-intro")) return tour("3-intro");
      if (/\btutorial\b/.test(text) && pages.length) return tour("intro");
      if (page && /\b(next|continue|go on|keep going|move on)\b/.test(text)) {
        const next = pages[pages.indexOf(page) + 1];
        return next ? tour(next) : courseMap("That was the tutorial's last page. Here's the course map.");
      }
      if (page && /\b(back|previous|prev)\b/.test(text)) {
        const prev = pages[pages.indexOf(page) - 1];
        return prev ? tour(prev) : tour(page);
      }

      // the contents rail's Welcome: the welcome screen, shown again
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
          "the tutorial (“tutorial”, “step 4”), the reference (“reference”, “reference page tools”), " +
          "the course map (“contents”), or a definition (“what is a handle?”). " +
          "Set ANTHROPIC_API_KEY on the server to talk to Claude instead.",
        onTextDelta,
      );
    },
  };
}
