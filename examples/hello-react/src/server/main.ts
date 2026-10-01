import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { scripted } from "./scripted.ts";
import { tools } from "./tools.ts";
import { greetingCardServer, greetingPickerServer } from "./surfaces.ts";

// HAI_SCRIPTED=1 swaps the model for a local stand-in — same interface, no key.
const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5176;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-opus-5", effort: "low" }),
  store: memoryStore(),                                   
  tools,                                                  
  surfaces: [greetingPickerServer, greetingCardServer],                       
  system: `You greet people in their chosen language through a UI that renders
tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the
user's browser, addressable by the handle in the digest (e.g. ui_01).

- Never state a specific fact about languages you have not seen. Use
  query_ui. Do not guess.                                
- list_greetings renders a picker and blocks until the user chooses. The
  component is the question — do not also ask them to type one.          
- Once they choose, greet them in that language and stop.`,
});

const handleHai = nodeHandler(hai, "/hai");

// The browser half. While developing, Vite runs inside this server as
// middleware: one process and one port, hot reload for the components, and
// /hai answered by the same server, so there is no proxy to set up. In
// production, `npm run build` has written dist/, served here as plain files.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const vite = PRODUCTION
  ? null
  : await (await import("vite")).createServer({ root: ROOT, server: { middlewareMode: true }, appType: "spa" });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
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
  })
  .listen(PORT, () => {
    const how = PRODUCTION ? "built" : "vite dev";
    console.log(`hello-react  http://localhost:${PORT}   ${how}   model=${SCRIPTED ? "scripted" : "claude-opus-5"}`);
    if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
      console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
    }
  });
