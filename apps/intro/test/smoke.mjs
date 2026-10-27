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
 * The page is built with Vite first and served from dist/, as the Dockerfile
 * serves it.
 *
 *   npm run smoke
 */

import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
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
try {
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], { cwd: APP, stdio: "pipe" });
  ok("builds with vite");
} catch (err) {
  bad(`vite build failed\n${err.stderr ?? err.message}`);
  process.exit(1);
}
const child = spawn(process.execPath, ["src/server/main.ts"], {
  cwd: APP,
  // nothing from the shell: no database, and no Google client to sign in with
  env: { ...process.env, HAI_SCRIPTED: "1", NODE_ENV: "production", PORT: String(PORT), DATABASE_URL: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" },
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
    // without a Google client, no one signs in, and there's nowhere to
    const me = await get(`${BASE}/auth/me`);
    JSON.stringify(about.signIn) === "[]" && me.status === 404
      ? ok("without a Google client, it offers no sign-in, and has no /auth routes")
      : bad(`without a Google client, version.json's signIn is ${JSON.stringify(about.signIn)} and /auth/me is ${me.status}`);

    // the page and what it loads, built into dist/
    const page = await get(`${BASE}/`).then((r) => r.text());
    const script = page.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    const sheet = page.match(/<link[^>]+href="(\/[^"]+\.css)"/)?.[1];
    for (const asset of [script, sheet, "/icon.svg"]) {
      const res = asset ? await get(`${BASE}${asset}`) : null;
      res?.ok ? ok(`serves ${asset}`) : bad(`${asset ?? "a script and a stylesheet in the page"} → ${res?.status ?? "missing"}`);
    }
    // one stylesheet: Tailwind with its preflight, the default UI's through
    // @haikit/client/tailwind.css, shadcn/ui's, and the course's palette,
    // with dark: following the chat's data-hai-theme pin
    const css = sheet ? await get(`${BASE}${sheet}`).then((r) => r.text()) : "";
    css.includes(".hai\\:") && css.includes("--hai-panel") && css.includes("#0f141a") && css.includes(".bg-primary") && /data-hai-theme="?dark/.test(css)
      ? ok("the stylesheet holds the default UI's utilities and tokens, shadcn/ui's, and the course's palette")
      : bad("the stylesheet is missing the default UI's utilities, its tokens, shadcn/ui's, or the course's palette");
    /\*,\s*:+after,\s*:+before/.test(css) ? ok("the stylesheet has Tailwind's preflight") : bad("the stylesheet has no preflight reset");

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
    const [second, third] = tutorial?.more ?? [];
    tutorial?.more?.length === 2 &&
    second.first.id === "2-intro" && second.steps === 9 && second.title === "Tell them later" &&
    third.first.id === "3-intro" && third.steps === 10 && third.title === "Who's asking"
      ? ok("…and the second and third tutorials after it, nine and ten steps, from 2-intro and 3-intro")
      : bad(`welcome's later tutorials: ${JSON.stringify(tutorial?.more)}`);
    const { today, versus, example, tokens, values } = welcomeProps ?? {};
    welcomeProps?.summary?.length > 40 ? ok("welcome says what HaiKIT is under the lede") : bad("welcome has no summary");
    [today?.before, today?.after].every((side) => side?.title && side.points?.length === 3 && side.image?.kind && side.image.alt?.length > 40)
      ? ok("welcome sets software today beside software HaiKIT builds, each drawn and described in words")
      : bad(`welcome's comparison: ${JSON.stringify(today)}`);
    [versus?.chatbot, versus?.haikit].every((side) => side?.name && side.tag && side.scene?.some((l) => l.from === "you")) &&
    versus.haikit.scene.some((l) => l.from === "click") &&
    versus.rows?.length >= 4 && versus.rows.every((r) => r.topic && r.chatbot && r.haikit)
      ? ok("welcome sets a chatbot beside an app against an app built with HaiKIT: one request in each, then row by row")
      : bad(`welcome's comparison with a chatbot: ${JSON.stringify(versus)}`);
    example?.steps?.length === 6 && example.steps.every((st) => st.title && st.text && st.scene?.length) && example.demo?.url === "https://rebook.haikit.app/"
      ? ok("welcome walks through the Rebook demo in six steps, each with its scene, and links to it")
      : bad(`welcome's example: ${JSON.stringify(example)}`);
    // the scenes draw Rebook's components, each under the tool that renders it
    const minis = (example?.steps ?? []).flatMap((st) => st.scene).filter((l) => "ui" in l);
    ["trip", "options", "seats", "choices", "pass"].every((ui) => minis.some((m) => m.ui === ui)) && minis.every((m) => m.tool && m.title)
      ? ok(`…and its scenes draw ${minis.length} of Rebook's components: a trip, options, a seat map, a question and a boarding pass`)
      : bad(`the walkthrough's components: ${JSON.stringify(minis.map((m) => m.ui))}`);
    const arch = example?.underneath?.architecture;
    arch?.nodes?.length === 3 && arch.links?.length === arch.nodes.length - 1 && arch.links.flat().every((a) => a.label)
      ? ok("welcome carries the architecture diagram, every arrow labelled")
      : bad("architecture diagram missing or malformed");
    tokens?.examples?.length >= 2 && tokens.examples.every((e) => e.name && e.screen > e.model && e.model > 0) &&
    tokens.points?.length >= 4 && tokens.points.every((pt) => pt.title && pt.text) && /\*\*Context\*\*/.test(tokens.see ?? "")
      ? ok("welcome shows how HaiKIT saves tokens: measured examples, the ways it does, and the Context drawer to watch it")
      : bad(`welcome's tokens section: ${JSON.stringify(tokens)}`);
    values?.groups?.length === 2 && values.groups.every((g) => g.audience && g.points?.length === 3)
      ? ok("welcome lists what you get, three values for each audience")
      : bad(`welcome's values: ${JSON.stringify(values)}`);
    const sections = [today, versus, example, tokens, values].filter(Boolean);
    const welcomeDigest = start.find((e) => e.type === "block_update")?.result ?? "";
    /lessons 1\.1–1\.\d.*lessons 2\.1–2\.\d/.test(welcomeDigest)
      ? ok("welcome digest tells the model which lessons exist")
      : bad(`welcome digest: ${welcomeDigest}`);
    ["https://github.com/wfoxd/haikit", "https://www.npmjs.com/search?q=haikit"].every((u) => welcomeDigest.includes(u))
      ? ok("the digest gives the model both links")
      : bad("a link is missing from the welcome digest");
    sections.length === 5 && sections.every((sec) => welcomeDigest.includes(sec.title))
      ? ok("the digest names each section, so the model can talk about them")
      : bad("a section is missing from the welcome digest");
    /~1958 tokens on screen and ~67 for the AI \(97% kept out\).*~665 tokens on screen and ~135 for the AI \(80% kept out\)/.test(welcomeDigest)
      ? ok("the digest gives the model the measured examples, so it can quote them")
      : bad(`tokens in the welcome digest: ${welcomeDigest}`);

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
      const tutorials = propsOf(map, mapUi?.handle)?.tutorials ?? [];
      tutorials.length === 3 && tutorials[0].pages.length === 12 && tutorials[1].pages.length === 11 && tutorials[2].pages.length === 12
        ? ok("the course map lists all three tutorials: 12 pages, then 11, then 12")
        : bad(`the course map's tutorials: ${JSON.stringify(tutorials.map((t) => t.pages.length))}`);
      const fromMap = await sse("/hai/interact", { conversationId: id, handle: mapUi?.handle, action: "open", value: "07" });
      propsOf(fromMap, opened(fromMap).find((e) => e.component === "tutorial_step")?.handle)?.id === "07"
        ? ok("the course map opens tutorial step 07")
        : bad("the map did not open step 07");
      // A version 2 map, stored before the second tutorial, has one `tutorial`;
      // a click on it is handled by today's code, from its stored props.
      const { courseMapServer } = await import("../src/server/surfaces.ts");
      const { tutorials: [firstTutorial], ...rest } = propsOf(map, mapUi?.handle) ?? { tutorials: [] };
      let opensOld = "";
      try {
        opensOld = await courseMapServer.impl.actions.open("07", { props: { ...rest, tutorial: firstTutorial }, handle: "ui_old", conversationId: id });
      } catch (err) {
        opensOld = `threw: ${err.message}`;
      }
      /^Opened tutorial step 07/.test(opensOld)
        ? ok("a version 2 map, with its one tutorial, still opens a tutorial page")
        : bad(`a version 2 map's click: ${opensOld}`);

      // every page renders: the steps by number, then the last page by Next
      const broken = [];
      for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
        const evs = await sse("/hai/chat", { conversationId: id, message: `step ${Number(n)}` });
        const got = propsOf(evs, opened(evs).find((e) => e.component === "tutorial_step")?.handle);
        if (got?.id !== n || !got.blocks?.length) broken.push(n);
        if (n === "10") {
          const last = await sse("/hai/interact", { conversationId: id, handle: opened(evs)[0]?.handle, action: "go", value: "next-steps" });
          const end = propsOf(last, opened(last).find((e) => e.component === "tutorial_step")?.handle);
          // the first tutorial's last page reads on into the second
          if (end?.id !== "next-steps" || end.next?.id !== "2-intro") broken.push("next-steps");
        }
      }
      broken.length ? bad(`tutorial pages that did not render: ${broken.join(", ")}`) : ok("all 12 tutorial pages render");

      // the browser links only https targets: a relative one would show as plain text
      const { TUTORIALS } = await import("../src/server/tutorial.ts");
      const prose = JSON.stringify(TUTORIALS.flatMap((t) => t.pages.flatMap((p) => p.blocks.filter((b) => b.kind !== "code"))));
      const targets = [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
      const unlinked = targets.filter((href) => !/^https:\/\//.test(href));
      !unlinked.length && targets.some((href) => href.startsWith("https://github.com/wfoxd/haikit/blob/main/docs/"))
        ? ok(`the tutorials' ${targets.length} links lead somewhere, a relative one to its document on GitHub`)
        : bad(`tutorial links the browser can't follow: ${unlinked.join(", ") || "(no docs link rewritten)"}`);
    }

    // 7b2 · the second tutorial: from the welcome, between its pages, from the map and by typing
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const screen = opened(fresh)[0];
      const pageOf = (evs) => {
        const ui = opened(evs).find((e) => e.component === "tutorial_step");
        return { ui, props: propsOf(evs, ui?.handle) };
      };
      const into = await sse("/hai/interact", { conversationId: id, handle: screen?.handle, action: "tutorial", value: "2-intro" });
      const intro = pageOf(into);
      intro.props?.id === "2-intro" && intro.props.tutorial === "Tell them later" && intro.props.prev?.id === "next-steps" &&
        intro.props.next?.id === "2-01" && intro.props.position?.index === 1 && intro.props.position?.total === 11
        ? ok("the welcome opens the second tutorial, page 1 of 11, after the first tutorial's last page")
        : bad(`the second tutorial's intro: ${JSON.stringify({ ...intro.props, blocks: undefined })}`);
      const first = await sse("/hai/interact", { conversationId: id, handle: intro.ui?.handle, action: "go", value: "2-01" });
      pageOf(first).props?.id === "2-01" ? ok("Next moves to its step 2-01") : bad("Next did not open step 2-01");

      const notices = await sse("/hai/chat", { conversationId: id, message: "Open tutorial step 2-05" });
      const five = pageOf(notices).props;
      const annotated = five?.blocks?.find((b) => b.kind === "code" && b.marks);
      five?.id === "2-05" && annotated?.file === "src/client/components.tsx" && annotated.marks.length === 4 && annotated.notes?.length === 4
        ? ok("the rail's choice opens step 2-05, its code with its file and its 4 numbered notes")
        : bad(`step 2-05: ${five?.id}, ${annotated?.file}, ${annotated?.marks?.length} marks`);

      const typed = await sse("/hai/chat", { conversationId: id, message: "show me the second tutorial" });
      pageOf(typed).props?.id === "2-intro" ? ok("typing “second tutorial” opens its introduction") : bad("“second tutorial” did not open it");

      const map = await sse("/hai/chat", { conversationId: id, message: "contents" });
      const mapUi = opened(map).find((e) => e.component === "course_map");
      const fromMap = await sse("/hai/interact", { conversationId: id, handle: mapUi?.handle, action: "open", value: "2-08" });
      pageOf(fromMap).props?.id === "2-08" ? ok("the course map opens tutorial step 2-08") : bad("the map did not open step 2-08");

      const broken = [];
      for (let n = 1; n <= 9; n++) {
        const want = `2-0${n}`;
        const evs = await sse("/hai/chat", { conversationId: id, message: `step ${want}` });
        const got = pageOf(evs);
        if (got.props?.id !== want || !got.props.blocks?.length) broken.push(want);
        if (n === 9) {
          const last = await sse("/hai/interact", { conversationId: id, handle: got.ui?.handle, action: "go", value: "2-next-steps" });
          const end = pageOf(last).props;
          if (end?.id !== "2-next-steps" || end.next?.id !== "3-intro") broken.push("2-next-steps");
        }
      }
      broken.length ? bad(`second tutorial pages that did not render: ${broken.join(", ")}`) : ok("all 11 pages of the second tutorial render");
    }

    // 7b3 · the third tutorial: from the welcome, the rail, typing and the
    //       course map, after the second's last page, and every page of it
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const screen = opened(fresh)[0];
      const pageOf = (evs) => {
        const ui = opened(evs).find((e) => e.component === "tutorial_step");
        return { ui, props: propsOf(evs, ui?.handle) };
      };
      const into = await sse("/hai/interact", { conversationId: id, handle: screen?.handle, action: "tutorial", value: "3-intro" });
      const intro = pageOf(into);
      intro.props?.id === "3-intro" && intro.props.tutorial === "Who's asking" && intro.props.prev?.id === "2-next-steps" &&
        intro.props.next?.id === "3-01" && intro.props.position?.index === 1 && intro.props.position?.total === 12
        ? ok("the welcome opens the third tutorial, page 1 of 12, after the second tutorial's last page")
        : bad(`the third tutorial's intro: ${JSON.stringify({ ...intro.props, blocks: undefined })}`);

      const signIn = await sse("/hai/chat", { conversationId: id, message: "Open tutorial step 3-04" });
      const four = pageOf(signIn).props;
      const annotated = four?.blocks?.find((b) => b.kind === "code" && b.marks);
      four?.id === "3-04" && annotated?.file === "src/server/sign-in.ts" && annotated.marks.length === 8 && annotated.notes?.length === 8
        ? ok("the rail's choice opens step 3-04, the sign-in page's code with its file and its 8 numbered notes")
        : bad(`step 3-04: ${four?.id}, ${annotated?.file}, ${annotated?.marks?.length} marks, ${annotated?.notes?.length} notes`);

      const typed = await sse("/hai/chat", { conversationId: id, message: "show me the sign-in tutorial" });
      pageOf(typed).props?.id === "3-intro" ? ok("typing “sign-in tutorial” opens its introduction") : bad("“sign-in tutorial” did not open it");

      const map = await sse("/hai/chat", { conversationId: id, message: "contents" });
      const mapUi = opened(map).find((e) => e.component === "course_map");
      const fromMap = await sse("/hai/interact", { conversationId: id, handle: mapUi?.handle, action: "open", value: "3-07" });
      pageOf(fromMap).props?.id === "3-07" ? ok("the course map opens tutorial step 3-07") : bad("the map did not open step 3-07");

      const broken = [];
      for (let n = 1; n <= 10; n++) {
        const want = `3-${String(n).padStart(2, "0")}`;
        const evs = await sse("/hai/chat", { conversationId: id, message: `step ${want}` });
        const got = pageOf(evs);
        if (got.props?.id !== want || !got.props.blocks?.length) broken.push(want);
        if (n === 10) {
          const last = await sse("/hai/interact", { conversationId: id, handle: got.ui?.handle, action: "go", value: "3-next-steps" });
          const end = pageOf(last).props;
          if (end?.id !== "3-next-steps" || end.next !== null) broken.push("3-next-steps");
        }
      }
      broken.length ? bad(`third tutorial pages that did not render: ${broken.join(", ")}`) : ok("all 12 pages of the third tutorial render, its last with nothing after it");
    }

    // 7b4 · a conversation saved before the second tutorial: its welcome digest
    //       doesn't mention it, so the scripted guide finds it in today's prompt
    {
      const { scripted } = await import("../src/server/scripted.ts");
      const system = readFileSync(path.join(APP, "src/server/main.ts"), "utf8").match(/const SYSTEM = `([\s\S]*?)`;/)?.[1] ?? "";
      const oldWelcome =
        'Welcome screen on display as ui_01: … Beside the place to start, HaiKIT\'s tutorial, built into this app: "Build your first HaiKIT app", ' +
        "steps 01–10; show_tutorial_step opens a page (intro, a step, or next-steps). The course: …";
      const messages = [
        { role: "user", content: "[conversation started]" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "welcome", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: oldWelcome }] },
        { role: "assistant", content: [{ type: "text", text: "Welcome." }] },
        { role: "user", content: "Open tutorial step 2-03" },
      ];
      const said = await scripted().generate({ system, tools: [], messages, onTextDelta() {} });
      const call = said.content.find((b) => b.type === "tool_use");
      call?.name === "show_tutorial_step" && call.input?.id === "2-03"
        ? ok("a conversation from before the second tutorial still opens its pages, from today's prompt")
        : bad(`an old conversation's "Open tutorial step 2-03": ${JSON.stringify(said.content)}`);
      messages[messages.length - 1] = { role: "user", content: "Open tutorial step 3-03" };
      const third = (await scripted().generate({ system, tools: [], messages, onTextDelta() {} })).content.find((b) => b.type === "tool_use");
      third?.name === "show_tutorial_step" && third.input?.id === "3-03"
        ? ok("…and the third tutorial's too")
        : bad(`an old conversation's "Open tutorial step 3-03": ${JSON.stringify(third)}`);

      // one saved when the third tutorial had nine steps: its digest stops at 3-09, today's prompt doesn't
      const nineSteps = oldWelcome.replace(
        "The course: …",
        'Then the second tutorial: "Tell them later", pages 2-intro and steps 2-01–2-09, then 2-next-steps. ' +
          'Then the third tutorial: "Who\'s asking", pages 3-intro and steps 3-01–3-09, then 3-next-steps. The course: …',
      );
      const resumed = [...messages.slice(0, 2), { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: nineSteps }] }, messages[3]];
      const ask = async (...turns) =>
        (await scripted().generate({ system, tools: [], messages: [...resumed, ...turns], onTextDelta() {} })).content.find((b) => b.type === "tool_use");
      const ten = await ask({ role: "user", content: "Open tutorial step 3-10" });
      ten?.name === "show_tutorial_step" && ten.input?.id === "3-10"
        ? ok("a conversation from when the third tutorial had nine steps opens step 3-10, from today's prompt")
        : bad(`a nine-step conversation's "Open tutorial step 3-10": ${JSON.stringify(ten)}`);
      const after = await ask(
        { role: "user", content: "Open tutorial step 3-09" },
        { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "show_tutorial_step", input: { id: "3-09" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "Tutorial page 3-09 on display as ui_02: …" }] },
        { role: "assistant", content: [{ type: "text", text: "Step 09." }] },
        { role: "user", content: "next" },
      );
      after?.name === "show_tutorial_step" && after.input?.id === "3-10"
        ? ok("…and “next” from 3-09 is 3-10, not 3-next-steps")
        : bad(`a nine-step conversation's "next" from 3-09: ${JSON.stringify(after)}`);

      // what the model is told it can show, against the tutorials themselves
      const { tutorialRefs } = await import("../src/server/tutorial.ts");
      const { showTutorialStep } = await import("../src/server/tools.ts");
      const stale = [1, 2, 3].flatMap((n) => {
        const ids = tutorialRefs(n).map((p) => p.id);
        const steps = ids.filter((id) => /^(\d+-)?\d+$/.test(id));
        const [intro, first, last, end] = [ids[0], steps[0], steps.at(-1), ids.at(-1)];
        return [
          [system, `(${intro}, ${first} to ${last}, ${end})`],
          [showTutorialStep.description, `${intro}, a step from ${first} to ${last}, or ${end}`],
          [showTutorialStep.inputJsonSchema.properties.id.description, `${intro}, ${first} … ${last}, ${end}`],
        ]
          .filter(([told, want]) => !told.includes(want))
          .map(([, want]) => want);
      });
      stale.length
        ? bad(`the model isn't told of every tutorial page; missing: ${stale.join("; ")}`)
        : ok("the prompt and show_tutorial_step give each tutorial's pages as the tutorials have them");
    }

    // 7c · the contents rail: what it lists, and what each kind of choice opens
    {
      const menu = await get(`${BASE}/menu.json`).then((r) => r.json());
      const lessons = menu.lessons.flatMap((p) => p.lessons);
      const pages = (menu.tutorials ?? []).map((t) => t.pages.map((p) => p.id));
      const each = (t, prefix, steps) =>
        t?.length === steps + 2 && t[0] === `${prefix}intro` && t[1] === `${prefix}01` && t.at(-1) === `${prefix}next-steps`;
      menu.lessons.length === 2 && lessons.length === 14 && pages.length === 3 && each(pages[0], "", 10) && each(pages[1], "2-", 9) && each(pages[2], "3-", 10)
        ? ok("the rail lists 14 lessons in 2 parts, and every page of the three tutorials: 12, 11 and 12")
        : bad(`menu.json: ${menu.lessons.length} parts, ${lessons.length} lessons, ${JSON.stringify(pages)}`);
      const manual = menu.reference?.pages ?? [];
      manual.length === 19 && manual[0].id === "index" && manual[0].title === "Contents" && manual[18].id === "limits"
        ? ok("…and the reference manual's 19 pages, its contents first")
        : bad(`menu.json reference: ${JSON.stringify(manual.map((p) => p.id))}`);
      const demos = menu.demos ?? [];
      demos.some((d) => d.title === "Rebook" && d.url === "https://rebook.haikit.app/" && d.detail) && demos.every((d) => /^https:\/\//.test(d.url))
        ? ok("…and the demos, Rebook among them, each at an https address")
        : bad(`menu.json demos: ${JSON.stringify(demos)}`);

      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const pick = async (message, component, check) => {
        const evs = await sse("/hai/chat", { conversationId: id, message });
        const ui = opened(evs).find((e) => e.component === component);
        return ui && check(propsOf(evs, ui.handle));
      };
      (await pick("Open lesson 1.3", "lesson", (p) => p?.id === "1.3"))
        ? ok("the rail's 1.3 opens lesson 1.3")
        : bad("the rail's lesson choice did not open 1.3");
      (await pick("Open tutorial step 04", "tutorial_step", (p) => p?.id === "04"))
        ? ok("…its 04 opens tutorial step 04")
        : bad("the rail's tutorial step choice did not open step 04");
      (await pick("Open tutorial page 3-intro", "tutorial_step", (p) => p?.id === "3-intro"))
        ? ok("…its Introduction opens the third tutorial's first page")
        : bad("the rail's tutorial page choice did not open 3-intro");
      (await pick("Open tutorial page next-steps", "tutorial_step", (p) => p?.id === "next-steps"))
        ? ok("…its Where to go next opens the first tutorial's last page")
        : bad("the rail's tutorial page choice did not open next-steps");
      (await pick("Open reference page limits", "reference_page", (p) => p?.id === "limits"))
        ? ok("…its Configuration and limits opens that page")
        : bad("the rail's reference choice did not open limits");
      (await pick("Show the course map", "course_map", (p) => p?.parts?.length === 2))
        ? ok("…its Course map shows the course map")
        : bad("the rail's Course map did not show the course map");
      (await pick("Show the welcome screen", "welcome", (p) => p?.intro?.length > 0))
        ? ok("…and its Welcome shows the welcome screen again")
        : bad("the rail's Welcome did not show the welcome screen");
    }

    // 7c2 · the reference manual: from the welcome, between its pages, by its
    //       links, from the rail and by typing; every page, every link
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      const screen = opened(fresh)[0];
      const panel = propsOf(fresh, screen?.handle)?.reference;
      panel?.pages?.length === 19 && panel.pages[0].id === "index" && panel.pages[0].title === "Contents" && panel.pages[18].id === "limits"
        ? ok("the welcome offers the reference manual's 19 pages, its contents first")
        : bad(`the welcome's reference: ${JSON.stringify(panel?.pages?.map((p) => p.id))}`);
      const said = fresh.find((e) => e.type === "block_update")?.result ?? "";
      /built into this app: 19 pages, index \(the contents\), concepts, .*, limits; show_reference_page opens one/.test(said)
        ? ok("the welcome digest names every page of the manual for the model")
        : bad(`the welcome digest on the manual: ${said}`);

      const pageOf = (evs) => {
        const ui = opened(evs).find((e) => e.component === "reference_page");
        const digest = evs.find((e) => e.type === "block_update" && /^Reference page /.test(e.result ?? ""))?.result ?? "";
        return { ui, props: propsOf(evs, ui?.handle), digest };
      };
      const into = await sse("/hai/interact", { conversationId: id, handle: screen?.handle, action: "reference", value: "surfaces" });
      const surfaces = pageOf(into);
      surfaces.ui?.mode === "elicit" && surfaces.props?.id === "surfaces" && surfaces.props.position.index === 3 &&
        surfaces.props.position.total === 19 && lastStatus(into) === "awaiting"
        ? ok("the welcome's panel opens Surfaces, page 3 of 19, waiting for the reader")
        : bad(`the welcome's Surfaces: ${JSON.stringify({ ...surfaces.props, blocks: undefined })}`);
      const digest = into.find((e) => e.type === "block_update" && /^Reference page surfaces/.test(e.result ?? ""))?.result ?? "";
      const pageTokens = Math.ceil(JSON.stringify(surfaces.props).length / 4);
      digest.includes("Sections: Schemas; Declaring a contract;") && digest.length / 4 < pageTokens / 20
        ? ok(`the model gets a digest (~${Math.ceil(digest.length / 4)} tok) of a page that stays in the browser (~${pageTokens} tok)`)
        : bad(`reference digest: ${digest}`);

      const off = await sse("/hai/interact", { conversationId: id, handle: surfaces.ui?.handle, action: "go", value: "ref:react" });
      /no way from surfaces to ref:react/.test(off.find((e) => e.type === "error")?.message ?? "")
        ? ok("a page only goes where its links and buttons go")
        : bad("a reference page accepted a jump it doesn't offer");
      // a link on Surfaces to a section of Tools
      const link = JSON.stringify(surfaces.props?.blocks).match(/\]\((ref:tools#([\w-]+))\)/);
      const moved = await sse("/hai/interact", { conversationId: id, handle: surfaces.ui?.handle, action: "go", value: link?.[1] });
      const tools = pageOf(moved);
      tools.props?.id === "tools" && tools.props.anchor === link?.[2] && tools.props.prev?.id === "surfaces"
        ? ok(`a link opens the page it names, at its section (${link?.[1]})`)
        : bad(`the link ${link?.[1]} opened ${JSON.stringify({ id: tools.props?.id, anchor: tools.props?.anchor })}`);
      const back = pageOf(await sse("/hai/interact", { conversationId: id, handle: tools.ui?.handle, action: "go", value: "ref:surfaces" }));
      back.props?.id === "surfaces" && back.props.anchor === null ? ok("Previous goes back to Surfaces, at its top") : bad("Previous did not go back");
      const contents = pageOf(await sse("/hai/interact", { conversationId: id, handle: back.ui?.handle, action: "go", value: "ref:index" }));
      contents.props?.id === "index" && contents.props.prev === null && contents.props.next?.id === "concepts"
        ? ok("Contents opens the index, the manual's first page")
        : bad("Contents did not open the index");
      // the contents shows no Contents button, so it can't be sent one
      const itself = await sse("/hai/interact", { conversationId: id, handle: contents.ui?.handle, action: "go", value: "ref:index" });
      /no way from index to ref:index/.test(itself.find((e) => e.type === "error")?.message ?? "")
        ? ok("the contents refuses a Contents click, since it has no such button")
        : bad("the contents accepted a Contents click it doesn't show");
      // the contents link to the tutorials, which are built in too
      const toTutorial = await sse("/hai/interact", { conversationId: id, handle: contents.ui?.handle, action: "go", value: "tutorial:intro" });
      propsOf(toTutorial, opened(toTutorial).find((e) => e.component === "tutorial_step")?.handle)?.id === "intro"
        ? ok("the contents' link to the tutorials opens the first tutorial here")
        : bad("the link to the tutorials did not open one");

      const typed = pageOf(await sse("/hai/chat", { conversationId: id, message: "show me the reference" }));
      typed.props?.id === "index" ? ok("typing “reference” opens its contents") : bad("“reference” did not open the manual");
      const atSection = pageOf(await sse("/hai/chat", { conversationId: id, message: "Open reference page surfaces at #freshness" }));
      atSection.props?.id === "surfaces" && atSection.props.anchor === "freshness"
        ? ok("a page opens at a section asked for by its anchor")
        : bad(`surfaces at #freshness: ${JSON.stringify({ id: atSection.props?.id, anchor: atSection.props?.anchor })}`);
      const nowhere = await sse("/hai/chat", { conversationId: id, message: "Open reference page nowhere" });
      const refused = nowhere.filter((e) => e.type === "text_delta").map((e) => e.text).join("");
      !pageOf(nowhere).ui && /There's no reference page nowhere\. Its pages are index, concepts/.test(refused)
        ? ok("a page the manual doesn't have is refused, with the pages it does")
        : bad("an unknown reference page was not refused");

      // every page renders, and every link on every page leads to a page and a section there are
      const shown = new Map();
      const digests = new Map();
      for (const page of panel?.pages ?? []) {
        const got = pageOf(await sse("/hai/chat", { conversationId: id, message: `Open reference page ${page.id}` }));
        if (got.props?.id === page.id && got.props.blocks.length) shown.set(page.id, got.props);
        digests.set(page.id, got.digest);
      }
      // the digest names only the buttons a page shows
      const buttons = (page) => digests.get(page)?.match(/its links and its (.*?) buttons?;/)?.[1];
      buttons("index") === "Next" && buttons("surfaces") === "Next, Previous and Contents" && buttons("limits") === "Previous and Contents"
        ? ok("each page's digest names only the buttons it shows: no Contents on the contents, no Next on the last")
        : bad(`digest buttons: ${JSON.stringify(["index", "surfaces", "limits"].map(buttons))}`);
      const anchorsOf = (blocks) =>
        blocks.flatMap((b) => (b.kind === "h" && b.id ? [b.id] : b.kind === "items" ? b.items.flatMap(anchorsOf) : []));
      const broken = [];
      let links = 0;
      for (const [page, props] of shown) {
        for (const [, target] of JSON.stringify(props.blocks).matchAll(/\]\(((?:ref:[\w-]+)?(?:#[\w-]+)?)\)/g)) {
          links++;
          const [, to = page, anchor] = target.match(/^(?:ref:([\w-]+))?(?:#([\w-]+))?$/) ?? [];
          const there = shown.get(to);
          if (!there || (anchor && !anchorsOf(there.blocks).includes(anchor))) broken.push(`${page} → ${target}`);
        }
      }
      shown.size === 19 && links > 500 && !broken.length
        ? ok(`all 19 reference pages render, and all ${links} of their links lead somewhere`)
        : bad(`reference pages shown: ${shown.size}; links that lead nowhere: ${broken.slice(0, 5).join(", ")}`);

      // nothing the Markdown holds is lost on the way: as many headings, code
      // blocks, table rows and list items on each page as in its file
      const tally = (blocks, t = { h: 0, code: 0, rows: 0, items: 0 }) => {
        for (const b of blocks) {
          if (b.kind === "h") t.h++;
          if (b.kind === "code") t.code++;
          if (b.kind === "table") t.rows += 1 + b.rows.length;
          if (b.kind === "items") {
            t.items += b.items.length;
            for (const item of b.items) tally(item, t);
          }
        }
        return t;
      };
      const lost = [];
      for (const [page, props] of shown) {
        const want = { h: 0, code: 0, rows: 0, items: 0 };
        let fenced = false;
        for (const line of readFileSync(path.join(APP, "content/reference", `${page}.md`), "utf8").split("\n")) {
          if (/^\s*```/.test(line)) {
            if (!fenced) want.code++;
            fenced = !fenced;
          } else if (!fenced) {
            if (/^#{2,4} /.test(line)) want.h++;
            // a table can sit in a list item, indented under its text
            if (/^\s*\|/.test(line) && !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) want.rows++;
            if (/^\s*([-*]|\d+\.) /.test(line)) want.items++;
          }
        }
        const got = tally(props.blocks);
        if (JSON.stringify(got) !== JSON.stringify(want)) lost.push(`${page}: ${JSON.stringify(got)}, its file ${JSON.stringify(want)}`);
        // and a row has a cell under each heading: a pipe in `a \| b` divides nothing
        const tables = JSON.stringify(props.blocks).match(/"kind":"table"/g)?.length ?? 0;
        const ragged = (function walk(blocks) {
          return blocks.flatMap((b) => (b.kind === "table" ? b.rows.filter((r) => r.length !== b.head.length) : b.kind === "items" ? b.items.flatMap(walk) : []));
        })(props.blocks);
        if (tables && ragged.length) lost.push(`${page}: a row of ${ragged[0].length} cells, ${ragged[0].join(" | ").slice(0, 60)}`);
      }
      !lost.length
        ? ok("every heading, code block, table row and list item in the manual's files is on its page")
        : bad(`reference pages that lost something: ${lost.join("; ")}`);

      // query_ui find: each answer says which section it's in
      const { referencePageServer } = await import("../src/server/surfaces.ts");
      const { makeCap } = await import("@haikit/core");
      const found = referencePageServer.impl.queries.find(
        { text: "staleAfterMs" },
        { props: shown.get("surfaces"), cap: makeCap(shown.get("surfaces")?.blocks.length ?? 0) },
      );
      // "Surface.implement:" is the section; the paragraph itself begins "Registers"
      /^\d+ of \d+ match/.test(found.text) && /^Surface\.implement: .*RangeError/m.test(found.text)
        ? ok("query_ui find answers from a page, naming each passage's section")
        : bad(`find on surfaces: ${found.text}`);
      // "N of TOTAL" counts blocks, as the runtime's TOTAL does: never more matches than there are
      const overcounted = [...shown].filter(([, props]) => {
        const head = referencePageServer.impl.queries.find({ text: "the" }, { props, cap: makeCap(props.blocks.length) }).text;
        const [, n, total] = head.match(/^(\d+) of (\d+) match/) ?? [];
        return !n || Number(n) > Number(total);
      });
      !overcounted.length
        ? ok("on every page, find's matches are blocks, never more than the page holds")
        : bad(`find counts more matches than blocks on ${overcounted.map(([id]) => id).join(", ")}`);

      // a link to a page or a section that isn't there stops the server, with the page, the line and the link
      const { readManual } = await import("../src/server/reference.ts");
      const index = "# Manual\n\n| Page |\n| --- |\n| [One](one.md) |\n";
      const refusal = (files) => {
        try {
          readManual(new Map(Object.entries(files)));
          return "";
        } catch (err) {
          return err.message;
        }
      };
      const noPage = refusal({ "index.md": index, "one.md": "# One\n\nSee [two](two.md).\n" });
      const noSection = refusal({ "index.md": index, "one.md": "# One\n\n## Here\n\nSee [there](#there) or [here](#here).\n" });
      /one\.md, line 3: a link to a page there isn't: ref:two\. Fix it in docs\/reference\/one\.md, then run npm run docs:update\./.test(noPage) &&
        /one\.md, line 5: a link to a section one\.md doesn't have: #there\. Fix it in docs\/reference\/one\.md/.test(noSection) &&
        refusal({ "index.md": index, "one.md": "# One\n\n## Here\n\nSee [here](#here).\n" }) === ""
        ? ok("a link to a page or a section the manual doesn't have stops the server, naming the line")
        : bad(`broken links: ${JSON.stringify([noPage, noSection])}`);
      const another = await sse("/hai/start", {});
      const unwelcome = await sse("/hai/interact", {
        conversationId: another.find((e) => e.type === "hello")?.conversationId,
        handle: opened(another)[0]?.handle,
        action: "reference",
        value: "nowhere",
      });
      /no reference page nowhere/.test(unwelcome.find((e) => e.type === "error")?.message ?? "")
        ? ok("the welcome refuses a reference page the manual doesn't have")
        : bad("the welcome accepted an unknown reference page");

      // a conversation saved before the manual: the guide finds its pages in the tool's description
      const { scripted } = await import("../src/server/scripted.ts");
      const { showReferencePage } = await import("../src/server/tools.ts");
      const answer = await scripted().generate({
        system: "",
        tools: [{ name: showReferencePage.name, description: showReferencePage.description, input_schema: {} }],
        messages: [{ role: "user", content: "Open reference page stores" }],
        onTextDelta() {},
      });
      const call = answer.content.find((b) => b.type === "tool_use");
      call?.name === "show_reference_page" && call.input?.page === "stores"
        ? ok("a conversation from before the manual still opens its pages, from the tool's description")
        : bad(`an old conversation's "Open reference page stores": ${JSON.stringify(answer.content)}`);
    }

    // 7d · how many people are reading now: the online signal, on the events stream
    {
      const fresh = await sse("/hai/start", {});
      const id = fresh.find((e) => e.type === "hello")?.conversationId;
      fresh.find((e) => e.type === "hello")?.events === true
        ? ok("hello opens the events stream, for the online count")
        : bad("hello did not open the events stream");
      const aborter = new AbortController();
      // the server sends its first count once it has been up 10 s, then every 3 s
      const timer = setTimeout(() => aborter.abort(), 16_000);
      let signal = null;
      try {
        const res = await fetch(`${BASE}/hai/events?conversationId=${id}`, { signal: aborter.signal });
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (!signal) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          // whole frames only: a read can end part way through one, which waits for the next
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data: "));
            const event = data ? JSON.parse(data.slice(6)) : null;
            if (event?.type === "signal" && event.name === "online" && event.payload.count >= 1) signal = event;
          }
        }
      } catch {}
      clearTimeout(timer);
      aborter.abort();
      signal
        ? ok(`an open tab hears the online count (${signal.payload.count} reading now)`)
        : bad("no online signal on the events stream");
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
    const registry = script ? await get(`${BASE}${script}`).then((r) => r.text()) : "";
    for (const component of ["welcome", "course_map", "lesson", "checkpoint", "next_lesson", "tutorial_step", "reference_page"]) {
      new RegExp(`\\b${component}\\s*:`).test(registry)
        ? ok(`${component} is registered in components.tsx`)
        : bad(`${component} missing from the client registry → "unknown component"`);
    }
  }
} finally {
  child.kill("SIGKILL");
}

// ── signing in with Google, optional: a second server, with a Google client
// to sign in with. Its tokens are made here, with its secret, as a sign-in
// would end; nothing reaches Google.
console.log("\nsigning in with Google");
{
  const SIGNED_PORT = PORT + 1;
  const SIGNED = `http://127.0.0.1:${SIGNED_PORT}`;
  const SECRET = "the smoke test's secret, at least 32 bytes long";
  const signed = spawn(process.execPath, ["src/server/main.ts"], {
    cwd: APP,
    env: {
      ...process.env,
      HAI_SCRIPTED: "1",
      NODE_ENV: "production",
      PORT: String(SIGNED_PORT),
      DATABASE_URL: "",
      GOOGLE_CLIENT_ID: "smoke.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "smoke",
      GOOGLE_REDIRECT_URI: `${SIGNED}/auth/google/callback`,
      HAIKIT_AUTH_SECRET: SECRET,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  signed.stderr.on("data", (d) => (errors += d));

  /** A token as signing in issues one, as its cookie. */
  const cookie = (sub, claims = {}, secret = SECRET) => {
    const now = Math.floor(Date.now() / 1000);
    const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub, iat: now, auth_time: now, exp: now + 600, jti: randomUUID(), ...claims })}`;
    return `__Host-haikit_token=${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const ada = cookie("google:ada", { name: "Ada" });
  const grace = cookie("google:grace", { name: "Grace" });

  /** A POST, as one reader or none: its status, and its events or its error. */
  async function as(reader, route, body, headers = {}) {
    const res = await fetch(`${SIGNED}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(reader ? { cookie: reader } : {}), ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE),
    });
    const text = await res.text();
    if (!res.headers.get("content-type")?.startsWith("text/event-stream")) return { status: res.status, error: JSON.parse(text || "{}").error, events: [] };
    const events = text
      .split("\n\n")
      .map((chunk) => chunk.split("\n").find((l) => l.startsWith("data: ")))
      .filter(Boolean)
      .map((l) => JSON.parse(l.slice(6)));
    return { status: res.status, events };
  }
  const idOf = (r) => r.events.find((e) => e.type === "hello")?.conversationId;

  try {
    if (!(await waitFor(`${SIGNED}/healthz`))) {
      bad(`with a Google client, the server did not start\n${errors}`);
    } else {
      const about = await get(`${SIGNED}/version.json`).then((r) => r.json());
      JSON.stringify(about.signIn) === '["google"]' ? ok("with a Google client, it offers to sign in with Google") : bad(`version.json's signIn is ${JSON.stringify(about.signIn)}`);
      const me = (reader) => fetch(`${SIGNED}/auth/me`, { headers: reader ? { cookie: reader } : {} }).then((r) => r.json());
      const [nobody, someone] = [await me(null), await me(ada)];
      nobody.user === null && someone.user?.id === "google:ada" && someone.user.claims.name === "Ada"
        ? ok("/auth/me says who's signed in, by their Google id and name, or no one")
        : bad(`/auth/me says ${JSON.stringify(nobody)} signed out, ${JSON.stringify(someone)} signed in`);

      const open = await as(null, "/hai/start", {});
      const opens = idOf(open);
      const [anyone] = opened(open.events);
      open.status === 200 && anyone?.component === "welcome" && propsOf(open.events, anyone.handle)?.intro && propsOf(open.events, anyone.handle).reader === undefined
        ? ok("signed out, anyone reads it, as without a Google client, and the welcome greets no one")
        : bad(`signed out, /hai/start is ${open.status} ${open.error ?? ""}`);
      const own = await as(ada, "/hai/start", {});
      const owns = idOf(own);
      const greeted = propsOf(own.events, opened(own.events)[0]?.handle)?.reader;
      greeted === "Ada" ? ok("signed in, the welcome greets the reader by name") : bad(`signed in, the welcome's reader is ${greeted}`);

      const peek = await as(null, "/hai/chat", { conversationId: owns, message: "Show the course map" });
      const other = await as(grace, "/hai/chat", { conversationId: owns, message: "Show the course map" });
      const stream = await get(`${SIGNED}/hai/events?conversationId=${owns}`);
      peek.status === 404 && other.status === 404 && stream.status === 404 && peek.error === "unknown conversation"
        ? ok("a conversation started signed in is no one else's: signed out or as someone else, it doesn't exist")
        : bad(`someone else's conversation: signed out ${peek.status}, as another ${other.status}, its events ${stream.status}`);
      const back = await as(ada, "/hai/chat", { conversationId: owns, message: "Show the course map" });
      back.status === 200 && opened(back.events).some((e) => e.component === "course_map")
        ? ok("…and its reader carries on in it")
        : bad(`its reader, carrying on: ${back.status} ${back.error ?? ""}`);
      const shared = await as(grace, "/hai/chat", { conversationId: opens, message: "Show the course map" });
      shared.status === 200 ? ok("a conversation started signed out is anyone's, signed in or not") : bad(`signed in, in one started signed out: ${shared.status} ${shared.error ?? ""}`);

      const forged = await as(cookie("google:ada", { name: "Ada" }, "another secret, at least 32 bytes long"), "/hai/start", {});
      const away = await as(ada, "/hai/chat", { conversationId: owns, message: "next" }, { origin: "https://elsewhere.example" });
      forged.status === 401 && forged.error === "your sign-in has expired or is invalid" && away.status === 403
        ? ok("a token it didn't sign is refused, as is the cookie sent from another site")
        : bad(`a token it didn't sign: ${forged.status} ${forged.error ?? ""}; from another site: ${away.status}`);
    }
  } finally {
    signed.kill("SIGKILL");
  }
}

// Without a Google client no one signs in. With a database, though, a
// conversation started signed in, while someone could, is still there: it
// stays closed. In this process, with a database that has one owner.
{
  const { signingIn } = await import("../src/server/auth.ts");
  const shell = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  const db = { query: async (_sql, params) => ({ rows: params?.[0] === "owned" ? [{ user_id: "google:ada" }] : [] }) };
  const open = await signingIn(null, PORT);
  const kept = await signingIn(db, PORT);
  if (shell.id !== undefined) process.env.GOOGLE_CLIENT_ID = shell.id;
  if (shell.secret !== undefined) process.env.GOOGLE_CLIENT_SECRET = shell.secret;

  !open.auth && !open.gate ? ok("without a Google client or a database, no sign-in and no gate") : bad("without a Google client or a database, there's sign-in or a gate");
  const who = await kept.gate?.admit({ route: "chat", method: "POST", headers: { "content-type": "application/json" } });
  const owned = who?.ok && (await kept.gate.allows(who.principal, "owned"));
  const anyones = who?.ok && (await kept.gate.allows(who.principal, "anyones"));
  !kept.auth && who?.ok && !owned && anyones
    ? ok("without a Google client but with a database, a conversation started signed in stays closed, and the rest are anyone's")
    : bad(`without a Google client but with a database: sign-in ${!!kept.auth}, admitted ${who?.ok}, the owned one ${owned}, the rest ${anyones}`);
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nsmoke: all checks passed\n");
process.exit(failures ? 1 : 0);
