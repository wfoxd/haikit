import { defineSurface, inform, query, resolve } from "@haikit/core";
import { z } from "zod";

export const Greeting = z.object({
  code: z.string(),                                     
  language: z.string(),
  text: z.string(),                                     
  script: z.string(),
  rtl: z.boolean(),                                     
  speakersM: z.number(),                                
});
export type Greeting = z.infer<typeof Greeting>;              

export const greetingPicker = defineSurface({
  name: "greeting_picker",                            
  version: 1,                                          
  props: z.object({ greetings: z.array(Greeting) }),    

  actions: {                                            
    choose: resolve(z.string()),                        
  },

  queries: {                                            
    filter: query(
      z.object({
        script: z.string().optional(),
        rtl: z.boolean().optional(),
      }),
      "Greetings in a given script or writing direction",
      {
        type: "object",
        properties: {
          script: { type: "string", description: "Latin, Han, Arabic, Hebrew, Japanese" },
          rtl: { type: "boolean", description: "true for right-to-left scripts only" },
        },
      },
    ),
  },
});

// A display surface: an artifact of the turn, not a question. The model keeps
// talking whether or not you touch it, so it declares no `resolve` action —
// which also means `mode: "elicit"` would not compile against it.
export const greetingCard = defineSurface({
  name: "greeting_card",
  version: 1,
  props: z.object({ greeting: Greeting }),

  actions: {
    // `inform` enriches the conversation without ever having blocked it.
    copy: inform(z.object({ code: z.string() })),
  },
});
