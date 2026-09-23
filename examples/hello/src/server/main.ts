import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { scripted } from "./scripted.ts";
import { tools } from "./tools.ts";
import { greetingPickerServer } from "./surfaces.ts";

// HAI_SCRIPTED=1 swaps the model for a local stand-in — same interface, no key.
const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PORT = Number(process.env.PORT) || 5175;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-opus-5", effort: "low" }),
  store: memoryStore(),                                   
  tools,                                                  
  surfaces: [greetingPickerServer],                       
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

// Static assets: this app's own public/, plus the client runtime served out of
// its package. A bundler would normally do this; here it stays a plain ESM
// import graph so there is no build step for app code.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const CLIENT = path.resolve(HERE, "../../../../packages/client/src");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    if (await handleHai(req, res)) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    const clientPrefix = "/hai-client/";
    let file: string;
    if (url.pathname.startsWith(clientPrefix)) {
      file = path.join(CLIENT, url.pathname.slice(clientPrefix.length));
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
  })
  .listen(PORT, () => {
    console.log(`hello  http://localhost:${PORT}   model=${SCRIPTED ? "scripted" : "claude-opus-5"}`);
    if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
      console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
    }
  });