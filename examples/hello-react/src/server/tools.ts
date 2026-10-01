import { defineTool } from "@haikit/core";
import { z } from "zod";
import { GREETINGS } from "./data.ts";
import { greetingCardServer, greetingPickerServer } from "./surfaces.ts";

export const listGreetings = defineTool({
  name: "list_greetings",                               
  description:                                            
    "Show the greeting picker. BLOCKS until the user chooses a language — the " +
    "component is the question, so do not also ask them to type one.",
  input: z.object({}),                                    
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },  

  async run(_input, ctx) {                                 
    return ctx.render(                                    
      greetingPickerServer,                               
      { greetings: GREETINGS },                           
      { mode: "elicit" },                                 
    );
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