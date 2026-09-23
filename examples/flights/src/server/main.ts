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

const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PORT = Number(process.env.PORT) || 5173;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-opus-5", effort: "medium" }),
  store: memoryStore(),
  tools,
  surfaces: [flightTableServer, seatMapServer],
  system: `You are a flight assistant embedded in a UI that renders tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the user's browser and is
addressable by the handle in the digest (e.g. ui_01).

Rules:
- Never state a specific fact about rows you have not seen. The digest holds precomputed highlights;
  anything beyond it requires query_ui. Do not guess.
- search_flights renders a picker and blocks until the user selects. The component is the question —
  do not also ask the user to type a choice.
- Keep replies to one or two sentences.`,
});

const handleHai = nodeHandler(hai, "/hai");

// Static: the app's own public/, plus the client runtime served from its
// package. A bundler would do this; here it stays a plain ESM import graph.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const CLIENT = path.resolve(HERE, "../../../../packages/client/src");
const SHARED = path.resolve(HERE, "../shared");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  if (await handleHai(req, res)) return;

  const url = new URL(req.url ?? "/", "http://localhost");
  let file: string;
  if (url.pathname.startsWith("/hai-client/")) {
    file = path.join(CLIENT, url.pathname.slice("/hai-client/".length));
    if (!file.startsWith(CLIENT)) return void res.writeHead(403).end("forbidden");
  } else {
    file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!file.startsWith(PUBLIC)) return void res.writeHead(403).end("forbidden");
  }

  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`flights   http://localhost:${PORT}   model=${SCRIPTED ? "scripted" : "claude-opus-5"}`);
  if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
    console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
  }
  void SHARED;
});
