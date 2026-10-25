/**
 * Flight search — an app built on hai.
 *
 * Everything below is app code. The framework contributes: the agent loop, the
 * dual channel, the elicit state machine, the interaction security boundary,
 * and a derived `query_ui`.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { scripted } from "./scripted.ts";
import { tools } from "./tools.ts";
import { flightTableServer, seatMapServer } from "./surfaces.ts";
import { fareDroppedServer, holdConfirmedServer } from "./notices.ts";
import { connectAirline } from "./airline.ts";

const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5173;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-haiku-5-5", effort: "medium" }),
  store: memoryStore(),
  tools,
  surfaces: [flightTableServer, seatMapServer],
  notices: [holdConfirmedServer, fareDroppedServer],
  // the airline revises the flight table with hai.update
  updates: true,
  system: `You are a flight assistant embedded in a UI that renders tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the user's browser and is
addressable by the handle in the digest (e.g. ui_01).

Rules:
- Never state a specific fact about rows you have not seen. The digest holds precomputed highlights;
  anything beyond it requires query_ui. Do not guess.
- search_flights renders a picker and blocks until the user selects. The component is the question —
  do not also ask the user to type a choice.
- Picking a flight asks the airline to hold the fare. Its confirmation arrives later as an
  [App notification: hold_confirmed]. Until one has, do not say the fare is held.
- Notifications can arrive with no message from the user. Then tell the user, in one sentence,
  what changed for them.
- A [UI update] means a component was revised: its new handle and digest replace the old ones.
- Keep replies to one or two sentences.`,
});
connectAirline(hai.notify, hai.update);

const handleHai = nodeHandler(hai, "/hai");

// The browser half. While developing, Vite runs inside this server as
// middleware: one process and one port, hot reload for the components and the
// Tailwind build, and /hai answered by the same server, so there is no proxy to
// set up. In production, `npm run build` has written dist/, served here as
// plain files.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  if (await handleHai(req, res)) return;
  if (vite) return vite.middlewares(req, res);

  const url = new URL(req.url ?? "/", "http://localhost");
  const file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (!file.startsWith(DIST)) return void res.writeHead(403).end("forbidden");
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end(PRODUCTION && url.pathname === "/" ? "not built — run `npm run build` first" : "not found");
  }
});

// Made after the server so hot reload can share its port: on a port of its
// own, two of these running at once would fight over it.
const vite = PRODUCTION
  ? null
  : await (await import("vite")).createServer({ root: ROOT, appType: "spa", server: { middlewareMode: true, ws: { server } } });

server.listen(PORT, () => {
  const how = PRODUCTION ? "built" : "vite dev";
  console.log(`flights   http://localhost:${PORT}   ${how}   model=${SCRIPTED ? "scripted" : "claude-haiku-5-5"}`);
  if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
    console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
  }
});