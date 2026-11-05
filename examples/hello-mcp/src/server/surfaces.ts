import { isMcpError } from "@haikit/mcp";
import { connectCard, noteDraft, noteList } from "../shared/surfaces.ts";
import { addNote } from "./mcp.ts";

const cut = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const connectCardServer = connectCard.implement({
  // all the model hears: never the link, and nothing the server said
  digest(p) {
    const what =
      p.need === "scope" ? `give ${p.label} more access` : p.need === "reconnect" ? `connect ${p.label} again, as it no longer takes their sign-in` : `connect ${p.label}`;
    return `Shown: a button for the user to ${what}. Its tools work once they have; you'll be told.`;
  },
  actions: {},
  queries: {},
});

export const noteListServer = noteList.implement({
  digest({ account, notes }, { handle }) {
    const latest = notes.slice(0, 3).map((n) => JSON.stringify(cut(n.text)));
    return `${account}'s ${notes.length} notes, newest first${latest.length ? `: ${latest.join(", ")}` : ""}. Rendered as ${handle}.`;
  },
  actions: {},
  queries: {},
});

export const noteDraftServer = noteDraft.implement({
  digest: (p, { handle }) => `A note for ${p.account}'s Notes, waiting on the user to save or discard it: ${JSON.stringify(p.text)}. Not saved yet. Rendered as ${handle}.`,

  actions: {
    // The only code that writes to Notes, and it runs on the user's click.
    // It saves the stored draft, never text from the browser.
    async decide(choice, ctx) {
      if (choice === "discard") return "Discarded: nothing was saved.";
      try {
        // As the conversation's owner. Keyed by the draft, so a click that
        // runs twice (see "at least once" in the manual) saves one note.
        const { note } = await addNote.call({ text: ctx.props.text, key: `${ctx.conversationId}/${ctx.handle}` }, ctx);
        return `Saved to ${ctx.props.account}'s notes: ${JSON.stringify(note.text)}.`;
      } catch (err) {
        // disconnected since the draft was shown
        if (isMcpError(err) && err.reason === "auth") return "Not saved: Notes needs the user to connect again.";
        // anything else refuses the click, and the draft stays for another
        throw err;
      }
    },
  },

  queries: {},
});
