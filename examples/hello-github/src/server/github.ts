import { randomBytes } from "node:crypto";
import type { Notify } from "@haikit/core";
import { createMcpAuth, http, mcpServer, memoryCredentialStore } from "@haikit/mcp";
import { z } from "zod";
import { auth } from "./auth.ts";
import { accountConnectedServer } from "./notices.ts";

// GitHub's MCP server, called as each user, with the GitHub account they
// connect through the app's routes. The model never sees it: the tools in
// ./tools.ts call it, and decide what the model hears and what the browser shows.

const PRODUCTION = process.env.NODE_ENV === "production";
/** The port main.ts listens on, which GitHub sends the browser back to. */
const PORT = Number(process.env.PORT) || 5179;

// Seals every token the store keeps. Without one, a random secret for this
// run: memoryCredentialStore forgets everything on a restart anyway.
const SECRET = process.env.HAIKIT_MCP_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
if (!SECRET) throw new Error("set HAIKIT_MCP_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");

// The GitHub App the app connects as: GitHub registers no client on the fly.
const { GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } = process.env;
if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
  throw new Error("set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET: the GitHub App's client ID and a client secret of it");
}

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
  // exactly as the GitHub App's callback URL, never worked out from the request: http only on localhost
  redirectUri: process.env.MCP_REDIRECT_URI ?? `http://localhost:${PORT}/mcp/callback`,
  // the routes act for whoever is signed in to the app
  requestUser: async (req) => (await auth.user(req))?.id ?? null,
  // the connect card's link names its conversation, kept only if it's this user's: wake it
  onConnected: async ({ server, conversationId }) => {
    if (conversationId) await notify?.(conversationId, accountConnectedServer, { server });
  },
});

export const github = mcpServer({
  name: "github",
  // the issues toolset, read-only: the only tools of GitHub's this app can reach
  transport: http(process.env.GITHUB_MCP_URL ?? "https://api.githubcopilot.com/mcp/x/issues/readonly"),
  auth: mcpAuth.oauth({
    // Pinned: a server names its own sign-in, and one compromised could name a fake one.
    issuer: process.env.GITHUB_MCP_ISSUER ?? "https://github.com/login/oauth",
    // A GitHub App takes this scope alone, for a refresh token. What it may do is its permissions.
    scopes: ["offline_access"],
    client: { id: GITHUB_APP_CLIENT_ID, secret: GITHUB_APP_CLIENT_SECRET },
  }),
});

/** An issue as GitHub's search sends it, cut to what this app uses: the schema drops every other field. */
const FoundIssue = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  // the browser opens it, so http or https, never a javascript: link
  html_url: z.url({ protocol: /^https?$/ }),
  user: z.object({ login: z.string() }),
  comments: z.number().default(0),
  updated_at: z.string(),
});

export const searchIssues = github.tool("search_issues", {
  args: z.object({
    query: z.string().min(1).max(256),
    owner: z.string().optional(),
    repo: z.string().optional(),
    perPage: z.number().int().min(1).max(100).optional(),
  }),
  result: z.object({ total_count: z.number(), items: z.array(FoundIssue) }),
});

export const issueRead = github.tool("issue_read", {
  args: z.object({
    method: z.literal("get"),
    owner: z.string(),
    repo: z.string(),
    issue_number: z.number().int().positive(),
  }),
  // no result schema: the call resolves to the content GitHub sent, for textOf
});
