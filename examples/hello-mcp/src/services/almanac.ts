import { randomBytes } from "node:crypto";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bearerOf, bodyOf, json, listen, serveMcp } from "./http.ts";

/**
 * Almanac: a stand-in for a service with one key for the whole app, as a
 * weather or search API has, so the example runs offline. It knows nothing
 * of the app's users: whoever's conversation calls it, the call is the
 * app's, so it may only say what any user may hear.
 */
export async function startAlmanac() {
  /** The app's key, made for this run. A real one comes from the service's console. */
  const appKey = `alm_${randomBytes(24).toString("base64url")}`;

  const mcp = createMcpHandler(() => {
    const server = new McpServer({ name: "almanac", version: "1.0.0" });
    server.registerTool(
      "today",
      {
        description: "Today's date, in UTC, and how far through the year it is.",
        inputSchema: z.object({}),
        outputSchema: z.object({ date: z.string(), weekday: z.string(), dayOfYear: z.number(), daysInYear: z.number() }),
      },
      async () => {
        const now = new Date();
        const year = now.getUTCFullYear();
        const dayOfYear = Math.floor((Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
        const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
        const value = {
          date: now.toISOString().slice(0, 10),
          weekday: now.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" }),
          dayOfYear,
          daysInYear,
        };
        return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
      },
    );
    return server;
  });

  const server = await listen(async (req, res) => {
    if (new URL(req.url ?? "/", server.origin).pathname !== "/mcp") return void res.writeHead(404).end();
    if (bearerOf(req) !== appKey) return json(res, 401, { error: "invalid_token" }, { "www-authenticate": 'Bearer error="invalid_token"' });
    await serveMcp(mcp, req, res, await bodyOf(req), { token: appKey, clientId: "app", scopes: [] });
  });

  return { url: `${server.origin}/mcp`, appKey, close: server.close };
}
