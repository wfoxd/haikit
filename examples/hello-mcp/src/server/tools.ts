import { defineTool } from "@haikit/core";
import { isMcpError } from "@haikit/mcp";
import { z } from "zod";
import { ACCOUNTS } from "../shared/surfaces.ts";
import { auth } from "./auth.ts";
import { listEvents, listNotes, mcpAuth, today } from "./mcp.ts";
import { connectCardServer, noteDraftServer, noteListServer } from "./surfaces.ts";

const none = { type: "object", properties: {}, additionalProperties: false } as const;

/**
 * The connect card's props, for a call the user hadn't connected an account
 * for, or null for any other error. Only an oauth() server's error has a
 * link to connect at: `err.auth.connect`, for the browser alone.
 */
function connectCardFor(err: unknown) {
  if (!isMcpError(err) || err.reason !== "auth" || !err.auth?.connect) return null;
  return { server: err.server, label: ACCOUNTS[err.server] ?? err.server, need: err.auth.kind, href: err.auth.connect };
}

/**
 * Runs as the conversation starts, and tells the model which accounts the
 * user has connected. Notes' tools still show the connect card when it
 * isn't: the card is how the user connects.
 */
export const accounts = defineTool({
  name: "accounts",
  description: "Says who is signed in, and which of their accounts are connected. Runs by itself as the conversation starts.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    const owner = await auth.ownerOf(ctx.conversationId);
    if (owner === null) return ctx.text("Nobody is signed in.");
    const connected = new Set((await mcpAuth.connections(owner)).map((account) => account.name));
    const each = Object.entries(ACCOUNTS).map(([server, label]) =>
      connected.has(server) ? `${label} is connected.` : `${label} isn't connected: its tools show the user a button to connect it.`,
    );
    return ctx.text(`Signed in as ${owner}. ${each.join(" ")} Calendar and Almanac need no connecting.`);
  },
});

export const showNotes = defineTool({
  name: "show_notes",
  description:
    "Show the user's notes, from their Notes account. Display-only. If Notes isn't connected, it shows a button " +
    "to connect it instead, and you'll be told once they have.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    try {
      // as the conversation's owner, with their own Notes account
      return ctx.render(noteListServer, await listNotes.call({}, ctx));
    } catch (err) {
      const card = connectCardFor(err);
      if (card) return ctx.render(connectCardServer, card);
      throw err;
    }
  },
});

export const draftNote = defineTool({
  name: "draft_note",
  description:
    "Show the user a note to save to their Notes account. BLOCKS until they save or discard it: nothing is saved " +
    "without their click. If Notes isn't connected, it shows a button to connect it instead.",
  input: z.object({ text: z.string().min(1).max(500) }),
  inputJsonSchema: {
    type: "object",
    properties: { text: { type: "string", description: "The note, as the user would write it", maxLength: 500 } },
    required: ["text"],
    additionalProperties: false,
  },

  async run({ text }, ctx) {
    try {
      // a read first: which account it would be saved to, and that Notes is connected at all
      const { account, notes } = await listNotes.call({}, ctx);
      return ctx.render(noteDraftServer, { text, account, count: notes.length }, { mode: "elicit" });
    } catch (err) {
      const card = connectCardFor(err);
      if (card) return ctx.render(connectCardServer, card);
      throw err;
    }
  },
});

export const showAgenda = defineTool({
  name: "show_agenda",
  description: "Today's events, from the user's calendar.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    // as the conversation's owner, with the key the app keeps for them
    const { owner, events } = await listEvents.call({}, ctx);
    const each = events.map((e) => `${e.start} ${e.title} (${e.minutes} min)`);
    return ctx.text(`${owner}'s calendar today: ${each.join("; ")}.`);
  },
});

export const whatDay = defineTool({
  name: "what_day",
  description: "Today's date, and how far through the year it is.",
  input: z.object({}),
  inputJsonSchema: none,

  async run(_input, ctx) {
    // the app's own key: Almanac never hears who asked, and answers everyone alike
    const day = await today.call({}, ctx);
    return ctx.text(`${day.weekday} ${day.date}: day ${day.dayOfYear} of ${day.daysInYear}.`);
  },
});

export const tools = [showNotes, draftNote, showAgenda, whatDay];
