/**
 * Negative type tests for @haikit/mcp.
 *
 * Every line marked below MUST fail to compile. `npm run typetest` compiles
 * this file twice — once as-is (must be clean, so no @ts-expect-error is
 * stale) and once with the directives stripped (every marked line must error).
 *
 * The first two are the package's guarantee: an MCP tool is not a HaiKIT tool,
 * so `createHai({ tools })`, which takes `Tool[]`, can't be given one, and the
 * model never sees one. The rest keep calls typed by the app's own schemas,
 * made as a user given by a string, and each user's OAuth typed as the
 * store and the routes keep it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActionCtx, Schema, Tool, ToolCtx } from "@haikit/core";
import {
  createMcpAuth,
  http,
  mcpServer,
  memoryCredentialStore,
  type CredentialStore,
  type McpAccount,
  type McpAuthNeed,
  type McpConnected,
  type McpError,
  type McpResult,
} from "../../src/index.js";
import { pgCredentialStore, type Queryable } from "../../src/postgres.js";

declare const query: Schema<{ q: string }>;
declare const items: Schema<{ items: string[] }>;
declare const ctx: ToolCtx;
declare const actionCtx: ActionCtx<{ rows: string[] }>;
declare const appTool: Tool;

const github = mcpServer({ name: "github", transport: () => Promise.reject(new Error("not connected in a type test")) });
const search = github.tool("search_issues", { args: query, result: items });
const raw = github.tool("search_issues", { args: query });

// ── GUARANTEE: an MCP tool is not a HaiKIT tool ────────────────────────
// @ts-expect-error  Type 'McpTool<...>' is missing the following properties from type 'Tool<any>': description, input, inputJsonSchema, strict, run
const asTool: Tool = search;
// @ts-expect-error  not in the list createHai's `tools` takes, either
const tools: Tool[] = [appTool, raw];

// ── calls are typed by the app's schemas ───────────────────────────────
async function typed() {
  const found: { items: string[] } = await search.call({ q: "bug" }, ctx);
  const sent: McpResult = await raw.call({ q: "bug" }, actionCtx);
  await search.call({ q: "bug" });
  // @ts-expect-error  args are the `args` schema's type
  await search.call({ q: 5 });
  // @ts-expect-error  the result is the `result` schema's type
  const count: number = (await search.call({ q: "bug" })).items;
  // @ts-expect-error  with no `result` schema, the result is the content as sent
  (await raw.call({ q: "bug" })).items;
  // @ts-expect-error  a ctx's progress must take a Progress
  await search.call({ q: "bug" }, { progress: (p: string) => p });
  return [found, sent, count];
}

// @ts-expect-error  a result type can't be claimed without a schema that checks it
github.tool<{ q: string }, { items: string[] }>("search_issues", { args: query });

// ── calls as each user ─────────────────────────────────────────────────
const mcpAuth = createMcpAuth({ userOf: async (id: string) => (id === "c1" ? "u1" : null) });
const perUser = mcpServer({ name: "web", transport: http("https://example.com/mcp"), auth: mcpAuth.bearer(async () => "key") });
const fetchPage = perUser.tool("fetch", { args: query, result: items });
async function asEachUser(err: McpError) {
  await fetchPage.call({ q: "a" }, { userId: "u1" });
  await perUser.connect("u1");
  await perUser.forget("u1");
  const need: McpAuthNeed | undefined = err.auth;
  // @ts-expect-error  a user id is a string
  await fetchPage.call({ q: "a" }, { userId: 5 });
  // @ts-expect-error  bearer's function gives a token or null
  mcpAuth.bearer(() => 5);
  // @ts-expect-error  userOf gives a user id or null
  createMcpAuth({ userOf: () => 5 });
  // @ts-expect-error  an auth is made by an McpAuth, and says its kind
  mcpServer({ name: "x", transport: http("https://example.com/mcp"), auth: {} });
  return need;
}

// ── OAuth, and the app's own provider ──────────────────────────────────
declare const db: Queryable;
const store: CredentialStore = memoryCredentialStore();
const shared: CredentialStore = pgCredentialStore(db);
const withOAuth = createMcpAuth({
  userOf: async () => null,
  store,
  secret: ["a secret of 32 bytes, or more...", "the one before it, which still opens what it sealed"],
  redirectUri: "https://app.example.com/mcp/callback",
  requestUser: async (req: IncomingMessage) => (typeof req.headers["x-user"] === "string" ? req.headers["x-user"] : null),
  onConnected: ({ userId, server, conversationId }: McpConnected) => void [userId, server, conversationId],
});
const linear = mcpServer({
  name: "linear",
  transport: http("https://mcp.linear.app/mcp"),
  auth: withOAuth.oauth({ issuer: "https://linear.app", scopes: ["read"] }),
});
async function withAccounts(err: McpError) {
  const connect: string | undefined = err.auth?.connect;
  const accounts: McpAccount[] = await withOAuth.connections("u1");
  const connectedAt: number = accounts[0].connectedAt;
  const landed: boolean = await store.put("u1", "linear", "sealed", null);
  const leased: boolean = await store.lease("u1", "linear", "sealed", "holder", 60_000);
  const handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> = withOAuth.handler();
  await withOAuth.disconnect("u1");
  withOAuth.sdk(async () => ({ token: async () => "t" }));
  withOAuth.sdk(() => null);
  // @ts-expect-error  scopes are a list
  withOAuth.oauth({ scopes: "read" });
  // @ts-expect-error  a client needs its id
  withOAuth.oauth({ issuer: "https://linear.app", client: { secret: "s" } });
  // @ts-expect-error  requestUser gives a user id or null
  createMcpAuth({ userOf: () => null, requestUser: () => 5 });
  // @ts-expect-error  sdk's function gives a provider or null
  withOAuth.sdk(() => "token");
  // @ts-expect-error  when an account was connected is epoch ms
  const when: string = accounts[0].connectedAt;
  // @ts-expect-error  a write says only whether it landed
  const written: string = await store.put("u1", "linear", "sealed", null);
  // @ts-expect-error  a write names the value it expects there, or null for none
  await store.put("u1", "linear", "sealed");
  // @ts-expect-error  a lease names its holder, and how long it lasts
  await store.lease("u1", "linear", "sealed");
  return [connect, connectedAt, landed, leased, handle, when, written, linear, shared];
}

export { asTool, tools, typed, asEachUser, withAccounts };
