import { connectCard } from "@haikit/mcp";
import type { Greeting } from "../shared/surfaces.ts";      
import { greetingCard, greetingPicker, issueList } from "../shared/surfaces.ts";

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

export const greetingCardServer = greetingCard.implement({
  digest(props, { handle }) {
    const g = props.greeting;
    return `Card for ${g.language}: "${g.text}" (${g.script}). Rendered as ${handle}.`;
  },

  actions: {
    copy(value, { props }) {
      return `Copied the ${props.greeting.language} greeting (${value.code}) to the clipboard.`;
    },
  },

  queries: {},
});

// The connect card's contract is @haikit/mcp's; what the model hears of it is this app's.
export const connectCardServer = connectCard.implement({
  // all the model hears: never the link
  digest(p) {
    const what =
      p.need === "scope" ? `give ${p.label} more access` : p.need === "reconnect" ? `connect ${p.label} again, as it no longer takes their sign-in` : `connect ${p.label}`;
    return `Shown: a button for the user to ${what}. Its tools work once they have; you'll be told.`;
  },
  actions: {},
  queries: {},
});

const cut = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const issueListServer = issueList.implement({
  // Titles are whatever whoever opened each issue wrote: quoted, and cut short.
  digest({ query, total, issues }, { handle }) {
    const each = issues.map((i) => `${i.repo}#${i.number} ${JSON.stringify(cut(i.title))} (${i.state}, ${i.comments} comments)`);
    const shown = issues.length < total ? `, the first ${issues.length} shown` : "";
    const match = total === 1 ? "issue matches" : "issues match";
    return `${total} ${match} ${JSON.stringify(query)}${shown}${each.length ? `: ${each.join("; ")}` : ""}. Rendered as ${handle}.`;
  },
  actions: {},
  queries: {},
});
