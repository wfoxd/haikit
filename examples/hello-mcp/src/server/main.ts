import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { auth } from "./auth.ts";
import { connectNotices, mcpAuth } from "./mcp.ts";
import { accountConnectedServer } from "./notices.ts";
import { scripted } from "./scripted.ts";
import { signInPage } from "./sign-in.ts";
import { connectCardServer, noteDraftServer, noteListServer } from "./surfaces.ts";
import { accounts, tools } from "./tools.ts";

// HAI_SCRIPTED=1 swaps the model for a local stand-in — same interface, no key.
const SCRIPTED = process.env.HAI_SCRIPTED === "1";
const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5178;

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-haiku-5-5", effort: "low" }),
  store: memoryStore(),
  tools,
  surfaces: [connectCardServer, noteListServer, noteDraftServer],
  notices: [accountConnectedServer],
  init: accounts,
  system: `You help the user with their notes, their calendar and the date,
through a UI that renders tool results as interactive components.

Tools return a short DIGEST into your context. The full data goes to the
user's browser, addressable by the handle in the digest (e.g. ui_01).

- accounts has already run, and says which of the user's accounts are
  connected.
- An account that isn't connected shows the user a button to connect it.
  Don't ask them for a password, a key or a link: the button is how.
- When the user connects one, you're told, with no message from them. Then
  call the tool that needed it again.
- draft_note shows the note and blocks until the user saves or discards it.
  Nothing is saved until they click. Don't say a note was saved until the
  result says so.`,
});
connectNotices(hai.notify);

// The gate: only a signed-in user gets in, and only to conversations they started.
const handleHai = nodeHandler(hai, "/hai", { gate: auth.gate });
// GET /auth/me and POST /auth/sign-out
const handleAuth = auth.handler("/auth");
// GET /mcp/connect/notes, the callback, POST /mcp/disconnect/notes, GET /mcp/connections
const handleMcp = mcpAuth.handler();

// The browser half, as in hello-auth: Vite inside this server while
// developing, and dist/ as plain files in production.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  if (await handleHai(req, res)) return;
  if (await handleAuth(req, res)) return;
  if (await handleMcp(req, res)) return;
  // Node accepts targets a URL can't parse, such as `//[`; the handlers above leave them here
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return void res.writeHead(400).end("bad request");
  }
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
}

// Whatever a request throws is answered and logged, never left to take the server down.
const server = http.createServer((req, res) =>
  serve(req, res).catch((err) => {
    console.error("[hello-mcp] request failed:", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }),
);

// Made after the server so hot reload can share its port.
const vite = PRODUCTION
  ? null
  : await (await import("vite")).createServer({ root: ROOT, appType: "spa", server: { middlewareMode: true, ws: { server } } });

server.listen(PORT, () => {
  const how = PRODUCTION ? "built" : "vite dev";
  console.log(`hello-mcp  http://localhost:${PORT}   ${how}   model=${SCRIPTED ? "scripted" : "claude-haiku-5-5"}`);
  if (!process.env.HAIKIT_AUTH_SECRET) console.log("no HAIKIT_AUTH_SECRET — signing with a random secret: sign-ins end when this server stops");
  if (!SCRIPTED && !process.env.ANTHROPIC_API_KEY) {
    console.log("no ANTHROPIC_API_KEY — run `npm run mock` for the scripted model");
  }
});
