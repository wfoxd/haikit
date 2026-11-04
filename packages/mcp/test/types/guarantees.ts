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
 * and made as a user given by a string.
 */

import type { ActionCtx, Schema, Tool, ToolCtx } from "@haikit/core";
import { createMcpAuth, http, mcpServer, type McpAuthNeed, type McpError, type McpResult } from "../../src/index.js";

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

export { asTool, tools, typed, asEachUser };
