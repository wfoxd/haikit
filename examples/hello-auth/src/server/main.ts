import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { auth } from "./auth.ts";
import { scripted } from "./scripted.ts";
import { tools, welcome } from "./tools.ts";
import { greetingCardServer, greetingPickerServer } from "./surfaces.ts";
import { signInPage } from "./sign-in.ts";

// HAI_SCRIPTED=1 swaps the model for a local stand-in — same interface, no key.
const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5176;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-haiku-5-5", effort: "low" }),
  store: memoryStore(),
  tools,
  surfaces: [greetingPickerServer, greetingCardServer],
  init: welcome,
  system: `You greet people in their chosen language through a UI that renders
tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the
user's browser, addressable by the handle in the digest (e.g. ui_01).

- welcome has already run, and says who is signed in. Use their name.
- Never state a specific fact about languages you have not seen. Use
  query_ui. Do not guess.
- list_greetings renders a picker and blocks until the user chooses. The
  component is the question — do not also ask them to type one.
- Once they choose, greet them in that language and stop.`,
});

// The gate: only a signed-in user gets in, and only to conversations they started.
const handleHai = nodeHandler(hai, "/hai", { gate: auth.gate });
// GET /auth/me and POST /auth/sign-out
const handleAuth = auth.handler("/auth");

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
  if (await handleAuth(req, res)) return;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/sign-in") return signInPage(req, res, auth);
  // The chat page itself, to someone signed out: the sign-in page instead.
  if (url.pathname === "/" && !(await auth.user(req))) return void res.writeHead(303, { location: "/sign-in" }).end();

  if (vite) return vite.middlewares(req, res);
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

const vite = PRODUCTION
  ? null
  : await (await import("vite")).createServer({ root: ROOT, appType: "spa", server: { middlewareMode: true, ws: { server } } });

server.listen(PORT, () => {
  const how = PRODUCTION ? "built" : "vite dev";
  console.log(`hello-auth  http://localhost:${PORT}   ${how}   model=${SCRIPTED ? "scripted" : "claude-haiku-5-5"}`);
  if (!process.env.HAIKIT_AUTH_SECRET) console.log("no HAIKIT_AUTH_SECRET — signing with a random secret: sign-ins end when this server stops");
  if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
    console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
  }
});
