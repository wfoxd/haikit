import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoreAdapter } from "@haikit/core";
import { DEFAULT_SCOPE, createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { menu } from "./course/index.ts";
import { packageFile, packageVersion } from "./excerpts.ts";
import { scripted } from "./scripted.ts";
import { tools, welcome } from "./tools.ts";
import {
  checkpointServer,
  courseMapServer,
  lessonServer,
  nextLessonServer,
  tutorialStepServer,
  welcomeServer,
} from "./surfaces.ts";

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
- The header has a menu. Its choices arrive as messages: "Open lesson 1.3",
  "Open tutorial step 04", "Show the welcome screen". Show what they name;
  show_welcome shows the welcome screen.
- HaiKIT's tutorial is built in: show_tutorial_step shows a page (intro, 01 to
  10, next-steps), and each page waits for the reader's Previous, Next or
  Course map click. When they move, show the page they chose. To answer a
  question about a page, use query_ui find on its handle.
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
  tutorial and the glossary, or show the lesson or tutorial page that covers
  them.
- Don't write or debug code for the learner's own app. Point them at the
  tutorial step that covers what they're building.
- Asked for a checkpoint's answer, however it's put, don't give it.`;

/** The durable store, used when the deployment is given a database. */
async function postgres(url: string): Promise<StoreAdapter> {
  const { default: pg } = await import("pg");
  const { migrate, pgStore } = await import("@haikit/postgres");
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool); // creates haikit's two tables if they don't exist
  return pgStore(pool);
}

// #region create-hai
const hai = createHai({
  model: SCRIPTED
    ? scripted()
    : anthropic({ model: process.env.HAI_MODEL || "claude-haiku-5-5", effort: "low" }),
  store: DATABASE_URL ? await postgres(DATABASE_URL) : memoryStore(),
  init: welcome, // runs first in every conversation: the welcome screen
  tools, // show_lesson, ask_checkpoint, offer_next_lesson, show_course_map, show_tutorial_step, show_welcome
  surfaces: [welcomeServer, courseMapServer, lessonServer, checkpointServer, nextLessonServer, tutorialStepServer],
  system: SYSTEM,
  scope: SCOPE,
});

const handleHai = nodeHandler(hai, "/hai");
// #endregion create-hai

// ─────────────────────────────────────────────────── static files

// This app's own page, plus the client runtime served from wherever node
// resolves @haikit/client: the version installed in node_modules.
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const CLIENT = packageFile("@haikit/client", "src").path;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const PACKAGES = ["core", "server", "client", "anthropic", "postgres"].map((name) => ({
  name: `@haikit/${name}`,
  version: packageVersion(`@haikit/${name}`),
}));
const VERSION = JSON.stringify({
  haikit: PACKAGES[0].version,
  packages: PACKAGES,
  model: hai.config.model.id,
  store: DATABASE_URL ? "postgres" : "memory",
});

const MENU = JSON.stringify(menu());

const server = http.createServer(async (req, res) => {
  try {
    if (await handleHai(req, res)) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    if (url.pathname === "/healthz") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (url.pathname === "/menu.json") {
      return void res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-cache" }).end(MENU);
    }
    if (url.pathname === "/version.json") {
      return void res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" }).end(VERSION);
    }

    const clientPrefix = "/hai-client/";
    const [root, rel] = url.pathname.startsWith(clientPrefix)
      ? [CLIENT, url.pathname.slice(clientPrefix.length)]
      : [PUBLIC, url.pathname === "/" ? "index.html" : url.pathname.slice(1)];
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return void res.writeHead(403).end("forbidden");

    const body = await fs.readFile(file).catch(() => null);
    if (!body) return void res.writeHead(404).end("not found");
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

server.listen(PORT, () => {
  const model = SCRIPTED ? "scripted guide" : hai.config.model.id;
  const store = DATABASE_URL ? "postgres" : "memory (development only)";
  console.log(`haikit intro  http://localhost:${PORT}   haikit ${PACKAGES[0].version}   model=${model}   store=${store}`);
});

// Containers stop with SIGTERM: finish the requests in flight, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
