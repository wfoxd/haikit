import { randomBytes } from "node:crypto";
import type { Notify } from "@haikit/core";
import { createMcpAuth, http, mcpServer, memoryCredentialStore } from "@haikit/mcp";
import { z } from "zod";
import { almanacService, calendarService, notesService } from "../services/index.ts";
import { Note } from "../shared/surfaces.ts";
import { auth } from "./auth.ts";
import { accountConnectedServer } from "./notices.ts";

// The three MCP servers the app's tools call, each as a different identity:
//
//   notes      each user's own account there, which they connect through the app's routes   oauth()
//   calendar   each user's own key, which the app keeps                                       bearer()
//   almanac    the app's own key, the same whoever the conversation is for                    no auth
//
// The model never sees any of them. The tools in ./tools.ts call them, and
// decide what the model hears and what the browser shows.

const PRODUCTION = process.env.NODE_ENV === "production";
/** The port main.ts listens on, which the redirect URI comes back to. */
const PORT = Number(process.env.PORT) || 5178;

// Seals every credential the store keeps. Without one, a random secret for
// this run: memoryCredentialStore forgets everything on a restart anyway.
const SECRET = process.env.HAIKIT_MCP_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
if (!SECRET) throw new Error("set HAIKIT_MCP_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");

let notify: Notify | null = null;

/** Called once at startup with `hai.notify`, which `onConnected` wakes a conversation with. */
export function connectNotices(send: Notify) {
  notify = send;
}

export const mcpAuth = createMcpAuth({
  // a call in a conversation runs as its owner, in a wake turn too
  userOf: (id) => auth.ownerOf(id),
  // memoryCredentialStore keeps tokens in this process; pgCredentialStore shares them
  store: memoryCredentialStore(),
  secret: SECRET,
  // exactly as registered with Notes, never worked out from the request: http only on localhost
  redirectUri: process.env.MCP_REDIRECT_URI ?? `http://localhost:${PORT}/mcp/callback`,
  // the routes act for whoever is signed in to the app
  requestUser: async (req) => (await auth.user(req))?.id ?? null,
  // what Notes shows the user as they connect
  clientName: "hello-mcp",
  // the connect card's link names its conversation, kept only if it's this user's: wake it
  onConnected: async ({ server, conversationId }) => {
    if (conversationId) await notify?.(conversationId, accountConnectedServer, { server });
  },
});

// ── Notes: each user's own account ─────────────────────────────────────
export const notes = mcpServer({
  name: "notes",
  transport: http(notesService.url),
  auth: mcpAuth.oauth({
    // Pinned: a server names its own authorization server, and one
    // compromised could name a fake sign-in page.
    issuer: notesService.issuer,
    scopes: ["notes.read", "notes.write"],
  }),
});
export const listNotes = notes.tool("list_notes", {
  args: z.object({}),
  result: z.object({ account: z.string(), notes: z.array(Note) }),
});
export const addNote = notes.tool("add_note", {
  args: z.object({ text: z.string().min(1).max(500), key: z.string() }),
  result: z.object({ note: Note }),
});

// ── Calendar: each user's own key ──────────────────────────────────────
// A real app keeps the key each user gave it. This one asks Calendar for a
// user's the first time it's looked up, and keeps it for this run.
const calendarKeys = new Map<string, string>();

export const calendar = mcpServer({
  name: "calendar",
  transport: http(calendarService.url),
  auth: mcpAuth.bearer((userId) => {
    let key = calendarKeys.get(userId);
    if (key === undefined) calendarKeys.set(userId, (key = calendarService.issueKey(userId)));
    return key;
  }),
});
export const listEvents = calendar.tool("list_events", {
  args: z.object({}),
  result: z.object({
    owner: z.string(),
    events: z.array(z.object({ title: z.string(), start: z.string(), minutes: z.number() })),
  }),
});

// ── Almanac: the app's own key ─────────────────────────────────────────
// Every user's call is the app's, as in phase 1: give such a server only
// what every user may see and do.
export const almanac = mcpServer({
  name: "almanac",
  transport: http(almanacService.url, { headers: { Authorization: `Bearer ${almanacService.appKey}` } }),
});
export const today = almanac.tool("today", {
  args: z.object({}),
  result: z.object({ date: z.string(), weekday: z.string(), dayOfYear: z.number(), daysInYear: z.number() }),
});

// One identity, so it can be checked now: a declared tool it doesn't have
// stops the app here. Notes and Calendar are checked as each user's first call.
await almanac.connect();
