import { defineSurface, query, resolve } from "@haikit/core";   
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
    ),
  },
});