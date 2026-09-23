import type { Greeting } from "../shared/surfaces.ts";      
import { greetingPicker } from "../shared/surfaces.ts";

const fmt = (g: Greeting) =>                                
  `${g.language} (${g.code}): ${g.text} — ${g.script}, ${g.speakersM}M`;

const bySpeakers = (a: Greeting, b: Greeting) => b.speakersM - a.speakersM;  

export const greetingPickerServer = greetingPicker.implement({  
  digest(props, { handle }) {                             
    const scripts = new Set(props.greetings.map((g) => g.script));
    const top = [...props.greetings].sort(bySpeakers).slice(0, 3);  

    return [
      `${props.greetings.length} translations in ${scripts.size} scripts.`,  
      `Most spoken: ${top.map((g) => g.language).join(", ")}.`,    
      `${props.greetings.filter((g) => g.rtl).length} right-to-left.`,  
      `Rendered as ${handle}.`,                             
    ].join(" ");
  },

  actions: {
    choose(code, { props }) {                             
      const g = props.greetings.find((x) => x.code === code);
      if (!g) return `Selection failed: unknown code ${code}.`;  

      const rank = [...props.greetings].sort(bySpeakers)
        .findIndex((x) => x.code === code) + 1;               
      return (
        `Chose ${g.language}: "${g.text}". ${g.script} script, ` +  
        `${g.rtl ? "right-to-left" : "left-to-right"}, ${g.speakersM}M speakers. ` +
        `Rank: #${rank} of ${props.greetings.length} by speakers.`
      );
    },
  },

  queries: {
    filter(args, { props, cap }) {                        
      const rows = props.greetings
        .filter((g) => (args.script ? g.script === args.script : true))  
        .filter((g) => (args.rtl != null ? g.rtl === args.rtl : true))  
        .sort(bySpeakers);                                
      return cap(rows, fmt);                              
    },
  },
});