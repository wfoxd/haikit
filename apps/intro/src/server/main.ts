import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { StoreAdapter } from "@haikit/core";
import { DEFAULT_SCOPE, createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { googleSignIn } from "./auth.ts";
import { menu } from "./course/index.ts";
import { packageVersion } from "./excerpts.ts";
import { scripted } from "./scripted.ts";
import { tools, welcome } from "./tools.ts";
import {
  checkpointServer,
  courseMapServer,
  lessonServer,
  nextLessonServer,
  referencePageServer,
  tutorialStepServer,
  welcomeServer,
} from "./surfaces.ts";
import { online } from "../shared/signals.ts";

const PORT = Number(process.env.PORT) || 5180;
// No key, or HAI_SCRIPTED=1: the scripted guide. Anyone can take the course
// without the deployment paying for a model.
const SCRIPTED = process.env.HAI_SCRIPTED === "1" || !process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const SYSTEM = `You are the guide for HaiKIT's introduction. HaiKIT is a framework for
building whole apps with an LLM, where tools return interactive UI. The
introduction is a set of lessons, and it runs on HaiKIT itself, so the learner
experiences each idea while reading about it.

Tools return a short DIGEST into your context. The welcome screen, lessons,
checkpoints and the course map go to the learner's browser in full,
addressable by the handle in each digest (e.g. ui_01).

- The conversation opens on a welcome screen that asks where to begin. When
  the learner chooses, teach the lesson it names, or call show_course_map.
- To teach a lesson, call show_lesson and ask_checkpoint for the same id in the
  same reply. The lesson renders for reading; the checkpoint waits for an answer.
- Never reveal or hint at a checkpoint's answer. The grade arrives in the tool
  result once the learner clicks.
- After an answer, give one or two sentences of feedback grounded in the "Why:"
  line, then call offer_next_lesson with the "Next lesson" it names. Don't
  teach that lesson yet: the learner moves on by clicking the button. When there
  is no next lesson, show_course_map.
- When the learner chooses to continue to a lesson, teach it.
- The page has a contents rail. Its choices arrive as messages: "Open lesson
  1.3", "Open tutorial step 04", "Open tutorial step 2-03", "Open tutorial page
  3-intro", "Open reference page surfaces", "Show the welcome screen", "Show
  the course map". Show what they name; show_welcome shows the welcome screen.
- HaiKIT's three tutorials are built in: show_tutorial_step shows a page. The
  first builds a Hello, World! app (intro, 01 to 10, next-steps); the second
  teaches the same app notifications (2-intro, 2-01 to 2-09, 2-next-steps);
  the third signs people in to it (3-intro, 3-01 to 3-10, 3-next-steps).
  Each page waits for the reader's Previous, Next or Course map click. When
  they move, show the page they chose. To answer a question about a page, use
  query_ui find on its handle.
- HaiKIT's reference manual is built in too: show_reference_page shows a page
  (its description lists them), at a section if you pass its anchor. index
  is the contents; its symbol index names the page that documents each
  export. A page waits for the reader to click a link to
  another page, or Previous, Next or Contents: show what they chose, at the
  section the click names. For an exact answer about HaiKIT's API (a
  signature, an option, a default, an error's text), use query_ui find on the
  reference page that covers it, opening that page first if it isn't shown.
- Define haikit terms only from the course glossary: query_ui on the course
  map's handle with the glossary query. If the map hasn't been shown yet, call
  show_course_map first. The framework may be newer than what you know, so do
  not answer from memory.
- Keep your own messages short. The lessons carry the content. When it helps,
  point the learner at the Context drawer, opened from the header: it shows
  exactly what you have received.`;

// HaiKIT's default scope, plus where this guide's line falls: questions about
// HaiKIT are the course, help with the learner's own app is not.
const SCOPE = `${DEFAULT_SCOPE}
- Questions about HaiKIT are in scope. Answer them from the lessons, the
  tutorials, the reference manual and the glossary, or show the lesson,
  tutorial page or reference page that covers them.
- Don't write or debug code for the learner's own app. Point them at the
  tutorial step that covers what they're building.
- Asked for a checkpoint's answer, however it's put, don't give it.`;

/** The database, when the deployment is given one: the conversations, and who owns which. */
async function connect(url: string): Promise<Pool> {
  const { default: pg } = await import("pg");
  return new pg.Pool({ connectionString: url });
}
const db = DATABASE_URL ? await connect(DATABASE_URL) : null;

/** The durable store, used when the deployment is given a database. */
async function postgres(pool: Pool): Promise<StoreAdapter> {
  const { migrate, pgStore } = await import("@haikit/postgres");
  await migrate(pool); // creates haikit's two tables if they don't exist
  return pgStore(pool);
}

// Sign in with Google, once there's a Google client: optional for the reader.
const signIn = await googleSignIn(db, PORT);

// #region create-hai
const hai = createHai({
  model: SCRIPTED
    ? scripted()
    : anthropic({ model: process.env.HAI_MODEL || "claude-haiku-5-5", effort: "low" }),
  store: db ? await postgres(db) : memoryStore(),
  init: welcome, // runs first in every conversation: the welcome screen
  tools, // show_lesson, ask_checkpoint, offer_next_lesson, show_course_map, show_tutorial_step, show_reference_page, show_welcome
  surfaces: [
    welcomeServer,
    courseMapServer,
    lessonServer,
    checkpointServer,
    nextLessonServer,
    tutorialStepServer,
    referencePageServer,
  ],
  system: SYSTEM,
  scope: SCOPE,
  signals: [online], // the header's count of people reading now
});

// signed in with Google, a reader's conversations are theirs alone (auth.ts)
const handleHai = nodeHandler(hai, "/hai", { gate: signIn?.gate });
// #endregion create-hai
const handleAuth = signIn?.auth.handler("/auth"); // /auth/google, its callback, /auth/me, /auth/sign-out

// People reading now, for the header. Presence counts each open tab, on every
// server sharing the store; the header hears it at most every few seconds,
// and only when it has changed.
const ONLINE_EVERY_MS = 3_000;
// A server that has just started knows only its own tabs: the others' counts
// come with their next heartbeat, up to 10 s away (HaiKIT's default). Until
// then it sends nothing, so it can't tell every tab a count that leaves them out.
const STARTED_AT = Date.now();
const WARM_UP_MS = 10_000;
let latest = 0;
let sent = -1;
let waiting: ReturnType<typeof setTimeout> | null = null;
hai.onPresence((count) => {
  latest = count;
  waiting ??= setTimeout(
    () => {
      waiting = null;
      if (latest !== sent) hai.signal(online, { count: (sent = latest) });
    },
    Math.max(ONLINE_EVERY_MS, STARTED_AT + WARM_UP_MS - Date.now()),
  );
});

// ─────────────────────────────────────────────────── the page

// While developing, Vite runs inside this server as middleware: one process
// and one port, hot reload for the components, the contents rail and the Tailwind
// build. In production (NODE_ENV=production, as the Dockerfile sets it),
// `npm run build` has written dist/, served here as plain files.
const PRODUCTION = process.env.NODE_ENV === "production";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const PACKAGES = ["core", "server", "client", "anthropic", "postgres", "auth"].map((name) => ({
  name: `@haikit/${name}`,
  version: packageVersion(`@haikit/${name}`),
}));
const VERSION = JSON.stringify({
  haikit: PACKAGES[0].version,
  packages: PACKAGES,
  model: hai.config.model.id,
  store: DATABASE_URL ? "postgres" : "memory",
  signIn: signIn ? ["google"] : [], // the header offers what's here
});

const MENU = JSON.stringify(menu());

const server = http.createServer(async (req, res) => {
  try {
    if (await handleHai(req, res)) return;
    if (handleAuth && (await handleAuth(req, res))) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    if (url.pathname === "/healthz") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (url.pathname === "/menu.json") {
      return void res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-cache" }).end(MENU);
    }
    if (url.pathname === "/version.json") {
      return void res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }).end(VERSION);
    }

    if (vite) return vite.middlewares(req, res);

    const file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!file.startsWith(DIST + path.sep)) return void res.writeHead(403).end("forbidden");

    const body = await fs.readFile(file).catch(() => null);
    if (!body) return void res.writeHead(404).end(url.pathname === "/" ? "not built: run `npm run build` first" : "not found");
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// Made after the server so hot reload can share its port: on a port of its
// own, two servers running at once would fight over it.
const vite = PRODUCTION
  ? null
  : await (await import("vite")).createServer({ root: ROOT, appType: "spa", server: { middlewareMode: true, ws: { server } } });

server.listen(PORT, () => {
  const model = SCRIPTED ? "scripted guide" : hai.config.model.id;
  const store = DATABASE_URL ? "postgres" : "memory (development only)";
  const page = PRODUCTION ? "built" : "vite dev";
  const signing = signIn ? "google" : "off";
  console.log(`haikit intro  http://localhost:${PORT}   haikit ${PACKAGES[0].version}   ${page}   model=${model}   store=${store}   sign-in=${signing}`);
});

// Containers stop with SIGTERM: finish the requests in flight, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
