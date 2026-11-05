import { randomBytes } from "node:crypto";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bearerOf, bodyOf, json, listen, serveMcp } from "./http.ts";

/**
 * Calendar: a stand-in for a service that gives each user a key of their
 * own, as a tracker or a billing system might, so the example runs offline.
 * There's no sign-in to send the user to: its MCP server takes a user's key,
 * and answers with that user's calendar. `issueKey` stands in for wherever
 * the key comes from, such as the user pasting it into the app's settings,
 * or the app asking an admin API for one.
 */

/** What each user's day holds: the same three events, at times of their own. */
const DAY = [
  { title: "Stand-up", minutes: 15 },
  { title: "Lunch with Sam", minutes: 60 },
  { title: "Review the postcards", minutes: 30 },
];

export async function startCalendar() {
  /** Whose each key is. */
  const keys = new Map<string, string>();

  const mcp = createMcpHandler(({ authInfo }) => {
    const user = String(authInfo?.extra?.user);
    const server = new McpServer({ name: "calendar", version: "1.0.0" });
    const Event = z.object({ title: z.string(), start: z.string(), minutes: z.number() });
    server.registerTool(
      "list_events",
      { description: "Today's events, for the user whose key this is.", inputSchema: z.object({}), outputSchema: z.object({ owner: z.string(), events: z.array(Event) }) },
      async () => {
        // each user's day starts at an hour of their own, so two users' agendas differ
        const first = 9 + ([...user].reduce((n, c) => n + c.charCodeAt(0), 0) % 3);
        const events = DAY.map((e, i) => ({ ...e, start: `${String(first + i * 2).padStart(2, "0")}:30` }));
        const value = { owner: user, events };
        return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
      },
    );
    return server;
  });

  const server = await listen(async (req, res) => {
    if (new URL(req.url ?? "/", server.origin).pathname !== "/mcp") return void res.writeHead(404).end();
    const key = bearerOf(req);
    const user = key ? keys.get(key) : undefined;
    if (user === undefined) return json(res, 401, { error: "invalid_token" }, { "www-authenticate": 'Bearer error="invalid_token"' });
    await serveMcp(mcp, req, res, await bodyOf(req), { token: key!, clientId: "key", scopes: [], extra: { user } });
  });

  return {
    url: `${server.origin}/mcp`,
    /** A new key for `user`, which Calendar knows them by from then on. */
    issueKey(user: string) {
      const key = `cal_${randomBytes(24).toString("base64url")}`;
      keys.set(key, user);
      return key;
    },
    close: server.close,
  };
}
