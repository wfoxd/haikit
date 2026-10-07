/**
 * Smoke test: boots the course with the scripted guide and drives it the way
 * a learner does. The welcome screen parks the turn before anyone types, a
 * choice there leads to a lesson or the course map, an answer resumes a
 * parked turn, and typing instead closes the question.
 *
 * Catches what typechecking can't: a quoted region that no longer exists (the
 * server refuses to start), wire protocol drift after a haikit upgrade, a
 * state machine that stops parking, a binding table that stops rejecting.
 *
 *   npm run smoke
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT) || 5281;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};

// Every request has a deadline: a stream the server never ends, the failure
// this test exists to catch, fails it instead of hanging it.
const DEADLINE = 15_000;
const get = (url) => fetch(url, { signal: AbortSignal.timeout(DEADLINE) });

async function sse(route, body) {
  const events = [];
  try {
    const res = await fetch(`${BASE}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE),
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
  } catch (err) {
    if (err?.name !== "TimeoutError") throw err;
    throw new Error(`${route} did not end its stream within ${DEADLINE / 1000}s (${events.length} events so far)`);
  }
  return events;
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const lastStatus = (evs) => evs.filter((e) => e.type === "status").at(-1)?.status;
const opened = (evs) => evs.filter((e) => e.type === "ui_open");
const propsOf = (evs, handle) => evs.find((e) => e.type === "ui_props" && e.handle === handle)?.props;

console.log("\nhaikit intro");
const child = spawn(process.execPath, ["src/server/main.ts"], {
  cwd: APP,
  env: { ...process.env, HAI_SCRIPTED: "1", PORT: String(PORT), DATABASE_URL: "" },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

try {
  if (!(await waitFor(`${BASE}/healthz`))) {
    bad(`server did not start — every excerpt must resolve at startup\n${stderr}`);
  } else {
    ok("boots, with every live-source excerpt resolved");

    // the header reports the haikit that is actually installed
    const about = await get(`${BASE}/version.json`).then((r) => r.json());
    const manifest = fileURLToPath(import.meta.resolve("@haikit/core/package.json", `file://${APP}/`));
    const installed = JSON.parse(readFileSync(manifest, "utf8")).version;
    about.haikit === installed ? ok(`reports the installed haikit (${installed})`) : bad(`version.json says ${about.haikit}, installed is ${installed}`);

    // the page and the client runtime it loads, served from node_modules
    for (const asset of ["/", "/components.js", "/logo.js", "/svg.js", "/architecture.js", "/illustrations.js", "/menu.js", "/styles.css", "/hai-client/app.js", "/hai-client/hai.css"]) {
      const res = await get(`${BASE}${asset}`);
      res.ok ? ok(`serves ${asset}`) : bad(`${asset} → ${res.status}`);
    }

    // 1 · init parks the conversation on the welcome screen before anything is typed
    const start = await sse("/hai/start", {});
    const conversationId = start.find((e) => e.type === "hello")?.conversationId;
    const [welcome, ...extra] = opened(start);
    welcome?.component === "welcome" && welcome.mode === "elicit" ? ok("init shows the welcome screen as elicit") : bad("no welcome screen on start");
    extra.length === 0 ? ok("the course map is not shown at start") : bad(`start also showed ${extra.map((e) => e.component)}`);
    lastStatus(start) === "awaiting" ? ok("parks before the first message") : bad(`status is ${lastStatus(start)}`);
    const welcomeProps = propsOf(start, welcome?.handle);
    welcomeProps?.intro?.length && welcomeProps.first?.id === "1.1" ? ok("welcome carries the introduction") : bad("welcome props incomplete");
    const urls = (welcomeProps?.links ?? []).map((l) => l.url);
    urls.includes("https://github.com/wfoxd/haikit") && urls.includes("https://www.npmjs.com/search?q=haikit")
      ? ok("welcome links to the GitHub repository and the npm packages")
      : bad(`welcome links: ${JSON.stringify(welcomeProps?.links)}`);
    const tutorial = welcomeProps?.tutorial;
    tutorial?.steps?.length === 10 && tutorial.steps.every((st, i) => st.id === String(i + 1).padStart(2, "0"))
      ? ok("welcome lists the tutorial's ten steps, in order")
      : bad(`welcome tutorial: ${JSON.stringify(tutorial)}`);
    const arch = welcomeProps?.architecture;
    arch?.nodes?.length === 3 && arch.links?.length === arch.nodes.length - 1 && arch.links.flat().every((a) => a.label)
      ? ok("welcome carries the architecture diagram, every arrow labelled")
      : bad("architecture diagram missing or malformed");
    const sections = welcomeProps?.sections ?? [];
    sections.length === 3 && sections.every((sec) => sec.title && sec.points?.length === 3)
      ? ok("welcome carries its three sections, three points each")
      : bad(`welcome sections: ${JSON.stringify(sections.map((sec) => sec.title))}`);
    sections.every((sec) => sec.image?.kind && sec.image.alt?.length > 40)
      ? ok("each section names its illustration and describes it in words")
      : bad("a section is missing its image or its text alternative");
    const welcomeDigest = start.find((e) => e.type === "block_update")?.result ?? "";
    /lessons 1\.1–1\.\d.*lessons 2\.1–2\.\d/.test(welcomeDigest)
      ? ok("welcome digest tells the model which lessons exist")
      : bad(`welcome digest: ${welcomeDigest}`);
    ["https://github.com/wfoxd/haikit", "https://www.npmjs.com/search?q=haikit"].every((u) => welcomeDigest.includes(u))
      ? ok("the digest gives the model both links")
      : bad("a link is missing from the welcome digest");
    sections.every((sec) => welcomeDigest.includes(sec.title))
      ? ok("the digest names each section, so the model can talk about them")
      : bad("a section is missing from the welcome digest");

    const odd = await sse("/hai/interact", { conversationId, handle: welcome.handle, action: "begin", value: "somewhere" });
    /invalid action payload/.test(odd.find((e) => e.type === "error")?.message ?? "")
      ? ok("rejects a choice the contract doesn't allow")
      : bad("an undeclared choice was accepted");

    // the "See the course map" button: the guide shows the map with its new tool
    const toMap = await sse("/hai/interact", { conversationId, handle: welcome.handle, action: "begin", value: "course-map" });
    toMap.some((e) => e.type === "block_start" && e.block.kind === "tool" && e.block.name === "show_course_map")
      ? ok("choosing the map calls show_course_map")
      : bad("show_course_map was not called");
    const [map] = opened(toMap);
    map?.component === "course_map" && map.mode === "elicit" ? ok("the course map renders as elicit") : bad("no course map");
    const mapDigest = toMap.find((e) => e.type === "block_update" && /^Course map:/.test(e.result ?? ""))?.result ?? "";
    /1\.1 "[^"]+".*2\.\d "[^"]+"/.test(mapDigest) ? ok("map digest lists the lessons for the model") : bad(`map digest: ${mapDigest}`);

    // 2 · the binding table, and a handler that refuses a bad value
    const forged = await sse("/hai/interact", { conversationId, handle: map.handle, action: "delete_everything", value: 1 });
    forged.find((e) => e.type === "error")?.message === "unbound action" ? ok("rejects: unbound action") : bad("forged action accepted");
    const missing = await sse("/hai/interact", { conversationId, handle: map.handle, action: "open", value: "9.9" });
    /no lesson 9\.9/.test(missing.find((e) => e.type === "error")?.message ?? "")
      ? ok("a handler that throws refuses the click")
      : bad("unknown lesson was accepted");

    // 3 · a click on the map opens a lesson (display) and asks its checkpoint (elicit)
    const open = await sse("/hai/interact", { conversationId, handle: map.handle, action: "open", value: "1.2" });
    const [lessonUi, checkUi] = opened(open);
    lessonUi?.component === "lesson" && lessonUi.mode === "display" ? ok("lesson renders as display") : bad("no lesson surface");
    checkUi?.component === "checkpoint" && checkUi.mode === "elicit" ? ok("checkpoint renders as elicit") : bad("no checkpoint surface");
    lastStatus(open) === "awaiting" ? ok("the reply parks on the checkpoint") : bad(`status is ${lastStatus(open)}`);
    const checkProps = propsOf(open, checkUi?.handle);
    checkProps && !("answer" in checkProps) && checkProps.options?.length
      ? ok("the answer key never reaches the browser")
      : bad("checkpoint props carry the answer or no options");

    // 4 · the answer resolves the turn; the next lesson waits behind a button
    const answer = await sse("/hai/interact", { conversationId, handle: checkUi.handle, action: "answer", value: "b" });
    const label = answer.find((e) => e.type === "block_start" && e.block.kind === "interaction")?.block.label ?? "";
    /Answered checkpoint 1\.2 with B.*Correct\./.test(label) ? ok("click is graded on the server") : bad(`label: ${label}`);
    const upNext = opened(answer).find((e) => e.component === "next_lesson");
    upNext?.mode === "elicit" && propsOf(answer, upNext.handle)?.next?.id === "1.3"
      ? ok("after an answer, a button offers lesson 1.3")
      : bad("no next_lesson button for 1.3");
    !opened(answer).some((e) => e.component === "lesson") && lastStatus(answer) === "awaiting"
      ? ok("the next lesson isn't shown until the button is clicked")
      : bad("the next lesson was shown without a click");
    const go = await sse("/hai/interact", { conversationId, handle: upNext?.handle, action: "go", value: "next-lesson" });
    const nextLesson = opened(go).find((e) => e.component === "lesson");
    propsOf(go, nextLesson?.handle)?.id === "1.3" && opened(go).some((e) => e.component === "checkpoint")
      ? ok("clicking it teaches lesson 1.3")
      : bad("the click did not open lesson 1.3");
    const history = answer.filter((e) => e.type === "context").at(-1)?.messages ?? [];
    const resumed = history.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
    resumed.some((b) => /^Lesson 1\.2 /.test(b.content)) && resumed.some((b) => /Answered checkpoint 1\.2/.test(b.content))
      ? ok("the held sibling result goes out with the answer")
      : bad("the lesson's tool_result was not delivered with the answer");

    // 5 · typing instead of answering closes the question; query_ui answers from the glossary
    const typed = await sse("/hai/chat", { conversationId, message: "what is a handle?" });
    typed.some((e) => e.type === "ui_state" && e.state === "frozen") ? ok("typing closes the waiting question") : bad("question left open");
    const lookup = typed.find((e) => e.type === "block_update" && /^\d+ of \d+ match/.test(e.result ?? ""));
    /handle \(lesson 1\.3\)/.test(lookup?.result ?? "") ? ok("query_ui answers from the glossary, capped") : bad(`lookup: ${lookup?.result}`);
    lastStatus(typed) === "idle" ? ok("turn completes") : bad(`status is ${lastStatus(typed)}`);

    // 6 · every lesson renders, with code read from live source in part 2
    const ids = [...mapDigest.matchAll(/(\d+\.\d+) "/g)].map((m) => m[1]);
    const broken = [];
    let excerpts = 0;
    for (const id of ids) {
      const evs = await sse("/hai/chat", { conversationId, message: id });
      const lesson = propsOf(evs, opened(evs).find((e) => e.component === "lesson")?.handle);
      if (lesson?.id !== id || !opened(evs).some((e) => e.component === "checkpoint")) broken.push(id);
      excerpts += lesson?.blocks.filter((b) => b.kind === "code" && b.source).length ?? 0;
    }
    broken.length ? bad(`lessons that did not render: ${broken.join(", ")}`) : ok(`all ${ids.length} lessons render with a checkpoint`);
    excerpts >= 10 ? ok(`${excerpts} code excerpts read from live source`) : bad(`only ${excerpts} live excerpts`);

    // 7 · the "Start with lesson 1.1" button, in a new conversation
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const screen = opened(fresh)[0];
      const begun = await sse("/hai/interact", { conversationId: id, handle: screen?.handle, action: "begin", value: "first-lesson" });
      const lesson = propsOf(begun, opened(begun).find((e) => e.component === "lesson")?.handle);
      lesson?.id === "1.1" && opened(begun).some((e) => e.component === "checkpoint")
        ? ok("choosing to start teaches lesson 1.1")
        : bad("start did not open lesson 1.1");
      const asked = await sse("/hai/chat", { conversationId: id, message: "2.3" });
      propsOf(asked, opened(asked).find((e) => e.component === "lesson")?.handle)?.id === "2.3"
        ? ok("lessons can be opened by number without the map")
        : bad("2.3 did not open before the map was shown");
    }

    // 7b · the tutorial, built in: from the welcome, between its pages, from the map
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const screen = opened(fresh)[0];
      const into = await sse("/hai/interact", { conversationId: id, handle: screen?.handle, action: "tutorial", value: "03" });
      const page = opened(into).find((e) => e.component === "tutorial_step");
      const props = propsOf(into, page?.handle);
      page?.mode === "elicit" && props?.id === "03" && lastStatus(into) === "awaiting"
        ? ok("the welcome's tutorial panel opens step 03 in the app, waiting for Next")
        : bad("the welcome did not open tutorial step 03");
      const annotated = props?.blocks?.find((b) => b.kind === "code" && b.marks);
      annotated?.file === "src/server/surfaces.ts" && annotated.marks.length === 19 && annotated.notes?.length === 19
        ? ok("step 03's code carries its file and its 19 numbered notes")
        : bad(`step 03 code: ${annotated?.file}, ${annotated?.marks?.length} marks, ${annotated?.notes?.length} notes`);
      const digest = into.find((e) => e.type === "block_update" && /^Tutorial page 03/.test(e.result ?? ""))?.result ?? "";
      const pageTokens = Math.ceil(JSON.stringify(props).length / 4);
      digest && digest.length / 4 < pageTokens / 5
        ? ok(`the model gets a digest (~${Math.ceil(digest.length / 4)} tok) of a page that stays in the browser (~${pageTokens} tok)`)
        : bad("tutorial digest missing or not much smaller than the page");

      const off = await sse("/hai/interact", { conversationId: id, handle: page.handle, action: "go", value: "09" });
      /no way from 03 to 09/.test(off.find((e) => e.type === "error")?.message ?? "")
        ? ok("a page only goes where its buttons go")
        : bad("a page accepted a jump it doesn't offer");
      const next = await sse("/hai/interact", { conversationId: id, handle: page.handle, action: "go", value: "04" });
      const four = propsOf(next, opened(next).find((e) => e.component === "tutorial_step")?.handle);
      four?.id === "04" && four.prev?.id === "03" && four.next?.id === "05"
        ? ok("Next moves to step 04")
        : bad("Next did not open step 04");

      const typed = await sse("/hai/chat", { conversationId: id, message: "how do I start the tutorial?" });
      propsOf(typed, opened(typed).find((e) => e.component === "tutorial_step")?.handle)?.id === "intro"
        ? ok("typing “tutorial” opens its introduction")
        : bad("“tutorial” did not open the tutorial");

      const map = await sse("/hai/chat", { conversationId: id, message: "contents" });
      const mapUi = opened(map).find((e) => e.component === "course_map");
      propsOf(map, mapUi?.handle)?.tutorial?.pages?.length === 12
        ? ok("the course map lists the tutorial's 12 pages")
        : bad("the course map has no tutorial");
      const fromMap = await sse("/hai/interact", { conversationId: id, handle: mapUi?.handle, action: "open", value: "07" });
      propsOf(fromMap, opened(fromMap).find((e) => e.component === "tutorial_step")?.handle)?.id === "07"
        ? ok("the course map opens tutorial step 07")
        : bad("the map did not open step 07");

      // every page renders: the steps by number, then the last page by Next
      const broken = [];
      for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
        const evs = await sse("/hai/chat", { conversationId: id, message: `step ${Number(n)}` });
        const got = propsOf(evs, opened(evs).find((e) => e.component === "tutorial_step")?.handle);
        if (got?.id !== n || !got.blocks?.length) broken.push(n);
        if (n === "10") {
          const last = await sse("/hai/interact", { conversationId: id, handle: opened(evs)[0]?.handle, action: "go", value: "next-steps" });
          const end = propsOf(last, opened(last).find((e) => e.component === "tutorial_step")?.handle);
          if (end?.id !== "next-steps" || end.next !== null) broken.push("next-steps");
        }
      }
      broken.length ? bad(`tutorial pages that did not render: ${broken.join(", ")}`) : ok("all 12 tutorial pages render");
    }

    // 7c · the header menu: what it lists, and what each kind of choice opens
    {
      const menu = await get(`${BASE}/menu.json`).then((r) => r.json());
      const lessons = menu.lessons.flatMap((p) => p.lessons);
      menu.lessons.length === 2 && lessons.length === 14 && menu.tutorial.length === 10 && menu.tutorial[0].id === "01"
        ? ok("the menu lists 14 lessons in 2 parts, and the tutorial's 10 steps")
        : bad(`menu.json: ${menu.lessons.length} parts, ${lessons.length} lessons, ${menu.tutorial.length} steps`);

      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const pick = async (message, component, check) => {
        const evs = await sse("/hai/chat", { conversationId: id, message });
        const ui = opened(evs).find((e) => e.component === component);
        return ui && check(propsOf(evs, ui.handle));
      };
      (await pick("Open lesson 1.3", "lesson", (p) => p?.id === "1.3"))
        ? ok("Lesson › 1.3 opens lesson 1.3")
        : bad("the menu's lesson choice did not open 1.3");
      (await pick("Open tutorial step 04", "tutorial_step", (p) => p?.id === "04"))
        ? ok("Tutorial › 04 opens tutorial step 04")
        : bad("the menu's tutorial choice did not open step 04");
      (await pick("Show the welcome screen", "welcome", (p) => p?.intro?.length > 0))
        ? ok("Home › Welcome shows the welcome screen again")
        : bad("the menu's Home choice did not show the welcome screen");
    }

    // 8 · a definition before any map exists: the guide shows the map first
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const typed = await sse("/hai/chat", { conversationId: id, message: "what is a digest?" });
      opened(typed).some((e) => e.component === "course_map")
        ? ok("a definition with no map yet shows the map, where the glossary is")
        : bad("no map shown for an early definition");
      const again = await sse("/hai/chat", { conversationId: id, message: "what is a digest?" });
      /digest \(lesson 1\.3\)/.test(again.find((e) => /^\d+ of \d+ match/.test(e.result ?? ""))?.result ?? "")
        ? ok("asked again, it looks the term up")
        : bad("second ask did not query the glossary");
    }

    // 9 · each surface has a component in the browser registry
    const registry = await get(`${BASE}/components.js`).then((r) => r.text());
    for (const component of ["welcome", "course_map", "lesson", "checkpoint", "next_lesson", "tutorial_step"]) {
      new RegExp(`\\b${component}\\s*:`).test(registry)
        ? ok(`${component} is registered in components.js`)
        : bad(`${component} missing from the client registry → "unknown component"`);
    }
  }
} finally {
  child.kill("SIGKILL");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
