/**
 * The browser half against a real React and a DOM (jsdom). Every surface in
 * the registry mounts from its props, today's and the shapes older versions
 * saved, sends only the actions its contract declares, stops offering choices
 * once it's frozen, and writes payload text as text, never as HTML.
 *
 * The components are TSX, so Vite loads them, as it does in the browser;
 * the fixtures come from the server's own modules, so they're the props the
 * guide really sends.
 *
 *   npm run clienttest
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── a DOM, and the browser globals React, Radix and the components reach for
const { window } = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
globalThis.window = window;
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^(?:document|Node|getComputedStyle|requestAnimationFrame|cancelAnimationFrame|MutationObserver|NodeFilter)$|^(?:HTML|SVG)?\w*Element$|Event$/.test(name) && !(name in globalThis)) {
    globalThis[name] = window[name];
  }
}
window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.ResizeObserver = globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.Element.prototype.scrollIntoView = function () {};
// the rail remembers being closed; Node's own localStorage needs a file to work
Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });
globalThis.CSS ??= { escape: (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`) };
const copied = [];
Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (text) => void copied.push(text) }, configurable: true });
// a click whose request fails rejects, as in the browser, where it lands in the console
process.on("unhandledRejection", (err) => {
  if (!(err instanceof TypeError && err.message === "Failed to fetch")) throw err;
});
// tells React that updates here are flushed through act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};

const vite = await createServer({ root: APP, appType: "custom", logLevel: "error", server: { middlewareMode: true, hmr: false } });
try {
  const { act } = await import("react");
  const { registry } = await vite.ssrLoadModule("/src/client/components.tsx");
  const server = (file) => import(path.join(APP, "src/server", file));
  const { welcomeProps, courseMapProps, lessonProps, checkpointProps, lessonRef, menu } = await server("course/index.ts");
  const { tutorialRefs, tutorialOf } = await server("tutorial.ts");
  const { referencePageOf, referenceRefs } = await server("reference.ts");

  /** Mount a registry entry. Each send waits until `release()`, as a request in flight does. */
  async function mount(name, props, { mode = "elicit", state = "live", selection } = {}) {
    const el = document.createElement("div");
    document.body.append(el);
    const sent = [];
    let pending = [];
    const send = (action, value) => {
      sent.push([action, value]);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    let instance;
    await act(async () => {
      instance = registry[name].mount(el, props, { handle: "ui_01", mode, state, selection, send });
    });
    return {
      el,
      sent,
      freeze: (picked) => act(async () => instance.freeze(picked)),
      unmount: () => act(async () => instance.unmount()),
      // the server's answer comes back: the surface stays live unless frozen
      release: () =>
        act(async () => {
          for (const { resolve } of pending) resolve();
          pending = [];
        }),
      // or it never arrives: the request failed on its way
      fail: () =>
        act(async () => {
          for (const { reject } of pending) reject(new TypeError("Failed to fetch"));
          pending = [];
        }),
    };
  }
  const fire = (node, event) => act(async () => void node.dispatchEvent(event));
  const click = (node) => fire(node, new window.MouseEvent("click", { bubbles: true }));
  const key = (node, k) => fire(node, new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  const buttons = (el) => [...el.querySelectorAll("button")];
  const button = (el, text) => buttons(el).find((b) => b.textContent.trim() === text);
  const text = (el) => el.textContent.replace(/\s+/g, " ");

  // ── welcome: today's, and every shape a saved conversation may hold
  console.log("\nwelcome");
  const current = welcomeProps();
  {
    const w = await mount("welcome", current);
    check("it draws the logo, the lede and the story's five sections", !!w.el.querySelector('svg[aria-label="HaiKIT"]') && w.el.querySelectorAll("section h3").length >= 5 && text(w.el).includes(current.summary));
    check("it draws Rebook's components in the demo's steps", w.el.querySelectorAll('[role="group"][aria-label^="Rebook\'s"]').length > 0);
    check("each https link beside the logo opens a new tab", w.el.querySelectorAll('a[target="_blank"][aria-label$="(opens in a new tab)"]').length >= current.links.length);
    await click(button(w.el, "See the course map"));
    check("See the course map sends begin: course-map", JSON.stringify(w.sent) === '[["begin","course-map"]]');
    check("while it's on its way, nothing else can be chosen", buttons(w.el).every((b) => b.disabled));
    await w.release();
    check("refused, the screen stays live and the pick is let go", !button(w.el, "See the course map").disabled && !w.el.querySelector("[data-picked]"));
    await click(buttons(w.el).find((b) => b.textContent.startsWith("01")));
    check("a tutorial step sends tutorial: its id", JSON.stringify(w.sent.at(-1)) === '["tutorial","01"]');
    await w.release();
    // each tutorial that carries on is offered after the first, and opens at its introduction
    await click(buttons(w.el).find((b) => b.textContent.includes("Who's asking")));
    check(
      "the tutorials after the first are offered in turn, and the third opens at its introduction",
      text(w.el).indexOf("Tell them later") < text(w.el).indexOf("Who's asking") && JSON.stringify(w.sent.at(-1)) === '["tutorial","3-intro"]',
    );
    await w.release();
    await click(button(w.el, "Contents"));
    check("a page of the manual sends reference: its id", JSON.stringify(w.sent.at(-1)) === '["reference","index"]');
    await w.freeze("index");
    check("frozen, it says what was chosen and offers nothing", text(w.el).includes("You opened the reference manual.") && buttons(w.el).every((b) => b.disabled));
    check("the page chosen stays marked", button(w.el, "Contents")?.dataset.picked === undefined && button(w.el, "Contents").className.includes("bg-hai-selected"));
    await w.unmount();
    check("unmounted, its element is empty", w.el.childNodes.length === 0);
  }
  {
    const w = await mount("welcome", current, { mode: "display" });
    check("shown for display, it asks nothing", buttons(w.el).every((b) => b.disabled));
  }
  {
    const w = await mount("welcome", current, { state: "frozen", selection: "first-lesson" });
    check("mounted already answered, it says so", text(w.el).includes(`You started with lesson ${current.first.id}.`));
    const closed = await mount("welcome", current, { state: "frozen" });
    check("closed by typing, it says so", text(closed.el).includes("Closed when you typed instead of choosing."));
  }

  const { tokens: _tokens, ...v12 } = {
    ...current,
    example: { ...current.example, steps: current.example.steps.map((s) => ({ ...s, scene: s.scene.filter((line) => !("ui" in line)) })) },
  };
  const v13 = { ...v12, tokens: current.tokens };
  // 14: one later tutorial, as `next`, before `more` listed every one
  const { more: _more, ...firstTutorial } = current.tutorial;
  const v14 = { ...current, tutorial: { ...firstTutorial, next: current.tutorial.more[0] } };
  const { versus: _versus, ...v11 } = v12;
  const architecture = current.example.underneath.architecture;
  const point = (title) => ({ title, text: `${title}, in a **sentence**.` });
  const sections = ["payload-split", "llm-flow", "contract-split"].map((kind) => ({
    title: `About ${kind}`,
    lead: "A lead.",
    image: { kind, alt: `A drawing of ${kind}.` },
    points: [point("One"), point("Two"), point("Three")],
  }));
  const base = { intro: current.intro, parts: current.parts, first: current.first };
  const saved = {
    2: { ...base, architecture },
    3: { ...base, architecture, sections: sections.map(({ image: _image, ...s }) => s) },
    5: { ...base, architecture, sections, source: { label: "wfoxd/haikit", url: "https://github.com/wfoxd/haikit" } },
    7: { ...base, architecture, sections, links: current.links, tutorial: { title: "Tutorial", lead: "Read it on GitHub.", steps: [{ n: 1, title: "Step", url: "https://github.com/wfoxd/haikit" }] } },
    10: { ...base, architecture, sections, links: current.links, tutorial: current.tutorial, reference: current.reference },
    11: v11,
    12: v12,
    13: v13,
    14: v14,
  };
  for (const [version, props] of Object.entries(saved)) {
    const w = await mount("welcome", props);
    const lede = current.intro[0].split(/(?<=[.!?])\s+/)[0];
    const story = Number(version) >= 11;
    const parts = [
      text(w.el).includes(lede),
      !!button(w.el, `Start with lesson ${current.first.id}`),
      !!w.el.querySelector('figure svg[role="img"][aria-label^="' + architecture.caption + '"]'),
      story || Number(version) < 3 || sections.every((section) => text(w.el).includes(section.title)),
      Number(version) !== 5 || !!w.el.querySelector('a[aria-label="wfoxd/haikit on GitHub (opens in a new tab)"]'),
      Number(version) !== 7 || !text(w.el).includes("Start the tutorial"),
      Number(version) < 10 || !!button(w.el, "Contents"),
      Number(version) !== 12 || !text(w.el).includes(current.tokens.title),
      Number(version) !== 11 || !text(w.el).includes(current.versus.title),
      Number(version) !== 14 || (text(w.el).includes(current.tutorial.more[0].title) && !text(w.el).includes(current.tutorial.more[1].title)),
    ];
    check(`a welcome saved at version ${version} still renders, as it was`, parts.every(Boolean));
    await w.unmount();
  }

  // ── course map: today's, and the two before it
  console.log("\ncourse map");
  {
    const props = courseMapProps();
    const m = await mount("course_map", props);
    const rows = buttons(m.el).filter((b) => /^\d\.\d/.test(b.textContent));
    check("every lesson is a row to click", rows.length === props.parts.flatMap((p) => p.lessons).length);
    check("both tutorials are listed, numbered", text(m.el).includes("Tutorial 1") && text(m.el).includes("Tutorial 2"));
    check("the glossary folds away, every term in it", m.el.querySelectorAll("details dt").length === props.glossary.length);
    await click(rows[0]);
    check("a lesson's row sends open: its id", JSON.stringify(m.sent) === `[["open","${props.parts[0].lessons[0].id}"]]`);
    await m.freeze(props.parts[0].lessons[0].id);
    check("frozen, its rows are no longer buttons, and it says what was opened", rows.every((r) => !r.isConnected) && text(m.el).includes(`You opened lesson ${props.parts[0].lessons[0].id}.`));

    const v2 = await mount("course_map", { glossary: props.glossary, parts: props.parts, tutorial: { title: "Build your first HaiKIT app", pages: tutorialRefs(1) } });
    check("a map saved at version 2 lists its one tutorial, with the blurb it never had", text(v2.el).includes("Build a Hello, World! app with HaiKIT, step by step, read right here.") && !text(v2.el).includes("Tutorial 1"));
    const v1 = await mount("course_map", { glossary: props.glossary, parts: props.parts });
    check("a map saved at version 1 lists no tutorial", !text(v1.el).includes("Tutorial") && text(v1.el).includes("Course map"));
  }

  // ── a lesson: every kind of block, and text that stays text
  console.log("\nblocks");
  {
    const props = lessonProps("1.1");
    const step = (from, to, label) => ({ from, to, label, note: `${label}: a **note**.` });
    const blocks = [
      { kind: "p", text: "Text with `code`, **bold**, *italic*, a [link](https://example.com/) and <b>not bold</b>." },
      { kind: "h", text: "A heading" },
      { kind: "list", items: ["one", "two"] },
      { kind: "items", ordered: true, start: 3, items: [[{ kind: "p", text: "three" }], [{ kind: "p", text: "four" }, { kind: "list", items: ["nested"] }]] },
      { kind: "note", tone: "look", text: "Look at this." },
      { kind: "note", tone: "tip", text: "Try this." },
      { kind: "note", tone: "warn", text: "Mind this." },
      { kind: "callout", tone: "warning", title: "Careful", body: [{ kind: "p", text: "A paragraph." }, { kind: "list", items: ["a point"] }] },
      { kind: "details", summary: "More" },
      { kind: "p", text: "Folded away." },
      { kind: "details-end" },
      { kind: "code", lang: "ts", code: "const a = 1; // 1\n/* two\n lines */\nlet b = 'x';", file: "src/a.ts", action: "new file", marks: [{ line: 0, n: 1 }], notes: [{ n: 1, body: [{ kind: "p", text: "The first line." }] }] },
      { kind: "code", lang: "ts", code: "export {};", source: "src/b.ts, lines 1–1" },
      { kind: "code", lang: "bash", code: "npm start" },
      { kind: "diagram", text: "a → b", caption: "A diagram." },
      { kind: "table", head: ["Name", "What"], rows: [["`x`", "an **x**"]] },
      {
        kind: "compare",
        sides: [
          { title: "Prose", tone: "bad", sample: "Which one?", text: "Asked in words." },
          { title: "A list", tone: "good", picker: { caption: "Pick one", options: [{ id: "ua1", label: "UA1", detail: "$1" }, { id: "ua2", label: "UA2", detail: "$2" }], more: 3 }, text: "Asked with a list." },
        ],
      },
      { kind: "sequence", title: "A round trip", steps: [step("browser", "server", "ask"), step("server", "model", "call"), step("server", "server", "park")] },
    ];
    const l = await mount("lesson", { ...props, blocks }, { mode: "display" });
    const body = l.el;
    check("inline code, bold, italic and an https link become elements", !!body.querySelector("p code") && !!body.querySelector("p strong") && !!body.querySelector("p em") && !!body.querySelector('p a[href="https://example.com/"][target="_blank"]'));
    check("markup in a payload stays text", !body.querySelector("b") && text(body).includes("<b>not bold</b>"));
    check("an ordered list starts where it says", body.querySelector("ol[start='3']")?.children.length === 2 && !!body.querySelector("ol[start='3'] li ul"));
    check("notes and callouts are labelled asides", ["Look", "Try it", "Before you ship", "Warning"].every((label) => [...body.querySelectorAll('[role="note"]')].some((n) => n.textContent.startsWith(label))));
    check("a fold holds what's between details and details-end", body.querySelector("details summary")?.textContent === "More" && body.querySelector("details p")?.textContent === "Folded away.");
    const marked = body.querySelector('a[aria-label="Note 1"]');
    check("a numbered line links to its note, and the note back to it", !!marked && !!body.querySelector(`#${marked.getAttribute("href").slice(1)} a[aria-label="Show the line for note 1"]`));
    await click(marked);
    check("following the number moves the focus to its note", document.activeElement?.id === marked.getAttribute("href").slice(1));
    await click(document.activeElement.querySelector("a"));
    check("and the note's number, back to its line", document.activeElement?.id === marked.closest("[id]")?.id);
    check("a comment that spans lines is coloured on each", [...body.querySelectorAll("pre .italic")].some((s) => s.textContent === " lines */"));
    check("each code block has a copy button, and the live source its bar", body.querySelectorAll('button[title="Copy the code"]').length === 3 && text(body).includes("Live source") && text(body).includes("new file"));
    await click(body.querySelector('button[title="Copy the code"]'));
    check("copy puts the code as written on the clipboard", copied.at(-1) === blocks[11].code && body.querySelector('button[title="Copy the code"]').textContent === "Copied");
    check("a table, its cells inline", body.querySelector("table th")?.textContent === "Name" && !!body.querySelector("table td code") && !!body.querySelector("table td strong"));
    const radios = [...body.querySelectorAll('[role="radio"]')];
    check("the compare picker starts unchosen", radios.length === 2 && text(body).includes("Choose one: the click is the answer.") && text(body).includes("and 3 more"));
    await click(radios[1]);
    check("choosing shows what the click would send, and sends nothing", text(body).includes("Your click sends ua2") && l.sent.length === 0);
    const seq = body.querySelector("figure[tabindex='0']");
    check("the sequence starts at its first step", text(seq).includes("Step 1 of 3") && button(seq, "Back").disabled);
    await key(seq, "ArrowRight");
    await key(seq, "ArrowRight");
    check("the arrow keys step through it, to its last", text(seq).includes("Step 3 of 3") && button(seq, "Next step").disabled && text(seq).includes("park: a note."));
    await click(button(seq, "Back"));
    check("Back steps back", text(seq).includes("Step 2 of 3") && l.sent.length === 0);
    check("the recap is the digest's takeaways", props.takeaways.every((t) => text(body).includes(t)));

    const real = await mount("lesson", lessonProps("1.2"), { mode: "display" });
    check("lesson 1.2, as the course has it, renders", text(real.el).includes(lessonProps("1.2").title) && !!real.el.querySelector("figure[tabindex='0']"));
  }

  // ── the lesson's question, and what comes after it
  console.log("\ncheckpoint and up next");
  {
    const props = checkpointProps("1.1");
    const c = await mount("checkpoint", props);
    check("it asks the lesson's question, waiting", text(c.el).includes("Waiting for your answer") && text(c.el).includes(`Checkpoint ${props.lessonId}`));
    await click(buttons(c.el)[0]);
    await c.fail();
    check("an answer that never reaches the server leaves the question open to answer again", buttons(c.el).every((b) => !b.disabled));
    c.sent.length = 0;
    await click(buttons(c.el)[1]);
    check("an option sends answer: its id", JSON.stringify(c.sent) === `[["answer","${props.options[1].id}"]]` && buttons(c.el).every((b) => b.disabled));
    await c.freeze(props.options[1].id);
    await c.release();
    check("answered, it says so and stays closed", text(c.el).includes("Answered") && buttons(c.el).every((b) => b.disabled) && buttons(c.el)[1].className.includes("bg-hai-selected"));
    const closed = await mount("checkpoint", props, { state: "frozen" });
    check("closed by typing, it says so", text(closed.el).includes("Closed without an answer"));

    const next = lessonRef("1.2");
    const n = await mount("next_lesson", { next });
    await click(button(n.el, `Continue to lesson ${next.id}`));
    check("Continue sends go: next-lesson", JSON.stringify(n.sent) === '[["go","next-lesson"]]');
    await n.freeze("next-lesson");
    check("frozen, it says where you went", text(n.el).includes(`You continued to lesson ${next.id}.`));
  }

  // ── a tutorial page and a reference page: their buttons and links are the question
  console.log("\ntutorial and reference");
  {
    const refs = tutorialRefs();
    const at = refs.findIndex((r) => r.id === "2-05");
    const tutorial = tutorialOf("2-05");
    const index = tutorial.pages.findIndex((p) => p.id === "2-05");
    const page = tutorial.pages[index];
    const t = await mount("tutorial_step", {
      blocks: page.blocks,
      id: page.id,
      label: page.label,
      title: page.title,
      tutorial: tutorial.title,
      position: { index: index + 1, total: tutorial.pages.length },
      prev: refs[at - 1] ?? null,
      next: refs[at + 1] ?? null,
    });
    check("step 2-05 renders its code, marks and notes", t.el.querySelectorAll('a[aria-label^="Note "]').length === 4);
    check("its title has its number, without the second tutorial's prefix", t.el.querySelector("h2")?.textContent === `05${page.title}`);
    await click(buttons(t.el).find((b) => b.textContent.startsWith("Next: ")));
    check("Next sends go: the next page's id", JSON.stringify(t.sent) === `[["go","${refs[at + 1].id}"]]`);
    await t.freeze(refs[at + 1].id);
    check("frozen, it names where you went, by its number", text(t.el).includes(`You went on to ${refs[at + 1].id.replace(/^\d+-/, "")} ${refs[at + 1].title}.`));

    const manual = referenceRefs();
    const surfaces = referencePageOf("surfaces");
    const where = manual.findIndex((r) => r.id === "surfaces");
    const props = {
      blocks: surfaces.blocks,
      id: surfaces.id,
      title: surfaces.title,
      position: { index: where + 1, total: manual.length },
      prev: manual[where - 1] ?? null,
      next: manual[where + 1] ?? null,
      anchor: null,
    };
    const r = await mount("reference_page", props);
    const inPage = r.el.querySelector('a[href="#freshness"]');
    await click(inPage);
    check("a link to a section of the page sends nothing, and moves the focus there", !!inPage && r.sent.length === 0 && document.activeElement?.dataset.anchor === "freshness");
    const away = r.el.querySelector("a[data-go]");
    await click(away);
    check("a link to another page sends go: its target", JSON.stringify(r.sent) === `[["go","${away.dataset.go}"]]`);
    await r.freeze(away.dataset.go);
    check("frozen, its links are text again, the one followed marked", !away.hasAttribute("href") && away.className.includes("bg-hai-selected") && text(r.el).includes(`You went on to “${away.textContent}”.`));
    const c = await mount("reference_page", props);
    await click(button(c.el, "Contents"));
    check("Contents sends go: ref:index", JSON.stringify(c.sent) === '[["go","ref:index"]]');
    const index2 = await mount("reference_page", { ...props, id: "index", prev: null });
    check("the contents has no Contents button", !button(index2.el, "Contents"));
  }

  // ── the contents rail: what it lists, what a choice sends, and where the reader is
  console.log("\ncontents rail");
  {
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Contents } = await vite.ssrLoadModule("/src/client/contents.tsx");
    const data = menu();
    data.demos = [...data.demos, { title: "Plain", detail: "Not over https.", url: "http://example.com/" }];
    const narrow = window.matchMedia;
    const media = (matches) => (window.matchMedia = globalThis.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} }));

    /** A chat that keeps what's sent, and shows a page when told to, as a tool would. */
    function fakeChat() {
      const listeners = new Set();
      const chat = {
        state: { blocks: [], surfaces: new Map() },
        sent: [],
        send: async (message) => void chat.sent.push(message) ?? true,
        subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
        tell: (type) => act(async () => listeners.forEach((fn) => fn(chat.state, { type }))),
        show: (component, id) => {
          const handle = `ui_${String(chat.state.blocks.length).padStart(2, "0")}`;
          chat.state.blocks.push({ kind: "ui", id: handle, handle, toolId: "toolu" });
          chat.state.surfaces.set(handle, { handle, component, props: id === undefined ? {} : { id } });
          return chat.tell("ui_open");
        },
      };
      return chat;
    }
    async function rail() {
      const main = document.createElement("div");
      const slot = document.createElement("div");
      const host = document.createElement("span");
      main.append(slot);
      document.body.append(host, main);
      const chat = fakeChat();
      const root = createRoot(slot);
      await act(async () => root.render(createElement(Contents, { chat, data, main, button: host })));
      return { chat, main, slot, toggle: host.querySelector("button"), unmount: () => act(async () => root.unmount()) };
    }
    const row = (el, label) => buttons(el).find((b) => b.textContent.replace(/, opened$/, "").endsWith(label));
    const group = (el, title) => buttons(el).find((b) => b.hasAttribute("aria-expanded") && b.textContent.startsWith(title));

    // a wide screen: a column beside the chat
    media(true);
    localStorage.removeItem("intro:contents");
    const r = await rail();
    const nav = () => r.slot.querySelector('nav[aria-label="Contents"]');
    check("on a wide screen it's a column beside the chat, open, its button saying so", r.main.classList.contains("contents-open") && !!nav() && r.toggle?.getAttribute("aria-expanded") === "true");
    check(
      "it lists Welcome, the course map, the parts, the tutorials, the manual and the demos",
      ["Welcome", "Course map"].every((l) => row(nav(), l)) &&
        ["Part 1: ", "Part 2: ", "Build your first HaiKIT app", "Tell them later", "Who's asking", "HaiKIT reference manual"].every((t) => group(nav(), t)) &&
        text(nav()).includes("67 pages"),
    );
    check("its groups start closed", buttons(nav()).filter((b) => b.hasAttribute("aria-expanded")).every((b) => b.getAttribute("aria-expanded") === "false"));
    const demos = [...nav().querySelectorAll("a")];
    check("a demo is a link to a new tab, and only an https one", demos.length === 1 && demos[0].href === "https://rebook.haikit.app/" && demos[0].target === "_blank" && demos[0].rel === "noopener noreferrer");

    await r.chat.show("welcome");
    check("the welcome screen on screen is marked, without a tick", row(nav(), "Welcome").getAttribute("aria-current") === "page" && !text(nav()).includes(", opened"));
    await r.chat.show("tutorial_step", "3-04");
    const third = group(nav(), "Who's asking");
    check("a tutorial page on screen opens its group and is marked, and Welcome isn't", third.getAttribute("aria-expanded") === "true" && row(nav(), "Sign in")?.getAttribute("aria-current") === "page" && !row(nav(), "Welcome").hasAttribute("aria-current"));
    check("it has its tick, its group counts it, and so does the head", row(nav(), "Sign in").textContent.endsWith(", opened") && third.textContent.includes("1 of 11 opened") && text(nav()).includes("1 of 67 pages opened"));
    await r.chat.tell("text_delta");
    check("an event that shows no page changes nothing", row(nav(), "Sign in")?.getAttribute("aria-current") === "page");

    await click(row(nav(), "Introduction"));
    await click(row(nav(), "Where to go next"));
    await click(row(nav(), "Sign out everywhere"));
    await click(group(nav(), "Part 1: "));
    await click(row(nav(), "The UI is the question"));
    await click(group(nav(), "HaiKIT reference manual"));
    await click(row(nav(), "Configuration and limits"));
    await click(row(nav(), "Course map"));
    await click(row(nav(), "Welcome"));
    check(
      "each choice sends the message the guide answers",
      JSON.stringify(r.chat.sent) ===
        JSON.stringify([
          "Open tutorial page 3-intro",
          "Open tutorial page 3-next-steps",
          "Open tutorial step 3-08",
          "Open lesson 1.2",
          "Open reference page limits",
          "Show the course map",
          "Show the welcome screen",
        ]),
    );
    check("a page's number drops its tutorial's prefix; the manual's pages have none", row(nav(), "Sign in").textContent.startsWith("04") && !/^\d/.test(row(nav(), "Configuration and limits").textContent));

    await click(third);
    check(
      "closed by the reader, the group carries the mark for the page in it, and says so",
      third.getAttribute("aria-expanded") === "false" && !row(nav(), "Sign in") && third.className.includes("bg-hai-selected") && third.textContent.includes("the page on screen among them"),
    );
    await r.chat.show("tutorial_step", "3-05");
    check(
      "the next page opens it again, and the mark goes back to the page",
      third.getAttribute("aria-expanded") === "true" && row(nav(), "Say who's signed in")?.getAttribute("aria-current") === "page" && !third.textContent.includes("the page on screen"),
    );
    await r.chat.show("lesson", "2.1");
    check(
      "a lesson opens its part and is marked, and the tutorial keeps both its ticks",
      group(nav(), "Part 2: ").getAttribute("aria-expanded") === "true" &&
        !!nav().querySelector('[aria-current="page"]')?.textContent.startsWith("2.1") &&
        group(nav(), "Who's asking").textContent.includes("2 of 11 opened"),
    );

    r.chat.state.blocks = [];
    r.chat.state.surfaces = new Map();
    await r.chat.tell("reset");
    check("a new chat starts with nothing marked and no ticks", !nav().querySelector("[aria-current]") && !text(nav()).includes(", opened") && text(nav()).includes("67 pages"));

    await click(r.slot.querySelector('button[aria-label="Close the contents"]'));
    check(
      "closed, the column goes, the browser remembers, and the focus goes to its button",
      !r.main.classList.contains("contents-open") && !nav() && localStorage.getItem("intro:contents") === "closed" && document.activeElement === r.toggle && r.toggle.getAttribute("aria-expanded") === "false",
    );
    await r.unmount();
    const again = await rail();
    check("it stays closed the next time", !again.main.classList.contains("contents-open") && !again.slot.querySelector("nav"));
    await click(again.toggle);
    check("its button opens it again, and that's remembered too", again.main.classList.contains("contents-open") && !!again.slot.querySelector("nav") && localStorage.getItem("intro:contents") === "open");
    await again.unmount();

    // a narrow one: a sheet over the chat. Radix's dialog makes its own
    // events, which jsdom dispatches only if they're jsdom's.
    media(false);
    const nodeCustomEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = window.CustomEvent;
    const n = await rail();
    const sheet = () => document.querySelector('[role="dialog"]');
    check("on a narrow screen there's no column, only the button", !n.main.classList.contains("contents-open") && !n.slot.querySelector("nav") && n.toggle.getAttribute("aria-expanded") === "false");
    await click(n.toggle);
    check("its button opens a sheet with the contents", !!sheet() && text(sheet()).includes("Contents") && !!sheet().querySelector('nav[aria-label="Contents"]') && n.toggle.getAttribute("aria-expanded") === "true");
    // Radix gives the focus back once the sheet has gone, a moment later
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await click(row(sheet(), "Course map"));
    await settle();
    check("a choice sends its message, closes the sheet, and gives the focus back to its button", n.chat.sent.at(-1) === "Show the course map" && !sheet() && document.activeElement === n.toggle);
    await click(n.toggle);
    sheet().querySelector("button")?.focus();
    await key(sheet(), "Escape");
    await settle();
    check("Escape closes it too, the focus back on its button", !sheet() && document.activeElement === n.toggle);
    await n.unmount();
    globalThis.CustomEvent = nodeCustomEvent;
    window.matchMedia = globalThis.matchMedia = narrow;
  }
} finally {
  await vite.close();
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nclienttest: all checks passed\n");
process.exit(failures ? 1 : 0);
