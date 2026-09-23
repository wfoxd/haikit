import { defineTool } from "@haikit/core";
import { z } from "zod";
import { GREETINGS } from "./data.ts";
import { greetingPickerServer } from "./surfaces.ts";

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

export const tools = [listGreetings];