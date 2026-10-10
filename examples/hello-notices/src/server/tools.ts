import { defineTool } from "@haikit/core";
import { z } from "zod";
import { GREETINGS } from "./data.ts";
import { greetingCardServer, greetingPickerServer } from "./surfaces.ts";
import { addTranslationSoon } from "./translators.ts";

const BATCHES = 4;

export const listGreetings = defineTool({
  name: "list_greetings",
  description:
    "Show the greeting picker. BLOCKS until the user chooses a language — the " +
    "component is the question, so do not also ask them to type one.",
  input: z.object({}),
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },

  async run(_input, ctx) {
    // Stands in for asking the translators in batches, so the tool row has
    // progress to show while the user waits.
    ctx.progress({ message: "Asking the translators", done: 0, total: BATCHES });
    for (let done = 1; done <= BATCHES; done++) {
      await new Promise((r) => setTimeout(r, 150));
      ctx.progress({ done });
    }

    const shown = await ctx.render(greetingPickerServer, { greetings: GREETINGS }, { mode: "elicit" });
    // the translators add a language to this picker a little later
    if (shown.handle) addTranslationSoon(ctx.conversationId, shown.handle, GREETINGS);
    return shown;
  },
});

export const showGreeting = defineTool({
  name: "show_greeting",
  description: "Show one greeting as a large card. Display-only — does not block.",
  input: z.object({ code: z.string() }),
  inputJsonSchema: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const greeting = GREETINGS.find((g) => g.code === input.code);
    if (!greeting) return ctx.text(`Unknown language code ${input.code}.`);

    // No third argument — display is the default, so this resolves immediately
    // instead of parking the turn.
    return ctx.render(greetingCardServer, { greeting });
  },
});

export const tools = [listGreetings, showGreeting];