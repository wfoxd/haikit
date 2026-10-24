/**
 * The default UI (`mountChat`) in a DOM (jsdom), driven by a fetch that
 * answers with scripted event streams: it passes its polling options through
 * to the chat, and a message whose request fails comes back to the message
 * box, reported rather than left as an unhandled rejection. Its dock moves a
 * surface to the shelf and a window and back without mounting it again, and
 * `dock: false` leaves surfaces as they were.
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body><div id=app></div></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
for (const name of ["Node", "HTMLElement", "Event", "KeyboardEvent", "MouseEvent"]) globalThis[name] = dom.window[name];

const { mountChat } = await import("../packages/client/src/app.js");

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const sse = (events) => new Response(frames(events), { status: 200, headers: { "content-type": "text/event-stream" } });
// a response that sends nothing until its request is aborted
const silent = (init) =>
  new Response(new ReadableStream({ start(c) { init.signal?.addEventListener("abort", () => c.error(new Error("aborted"))); } }), { status: 200 });

const unhandled = [];
process.on("unhandledRejection", (err) => unhandled.push(err));
const logged = [];
const error = console.error;
console.error = (...args) => logged.push(args.map(String).join(" "));

console.log("default UI");
try {
  // a message whose request fails comes back to the box
  {
    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    const root = document.getElementById("app");
    const chat = mountChat({ root, registry: {} });
    await wait(20);
    const input = root.querySelector(".hai-input");
    input.value = "hello there";
    root.querySelector(".hai-send").click();
    await wait(50);
    check("a message whose request fails comes back to the message box", input.value === "hello there");
    check("…and is reported, not left unhandled", logged.some((l) => l.startsWith("[haikit] the message wasn't sent:")) && unhandled.length === 0);
    check("a start whose request fails is reported too", logged.some((l) => l.startsWith("[haikit] the conversation couldn't start:")));
    chat.close();
  }

  // the polling options reach the chat
  {
    const events = [];
    globalThis.fetch = async (url, init = {}) => {
      if (!String(url).includes("/events")) return sse([{ type: "hello", conversationId: "c1", model: "m", events: true }]);
      events.push({ url: String(url), at: Date.now() });
      return events.length === 1 ? silent(init) : sse([]);
    };
    const root = document.getElementById("app");
    const started = Date.now();
    const chat = mountChat({ root, registry: {}, eventsFallbackMs: 50, pollHoldMs: 1234 });
    for (const end = Date.now() + 3000; events.length < 2 && Date.now() < end; ) await wait(10);
    const poll = events[1];
    check(
      "eventsFallbackMs reaches the chat: a silent stream turns to polling in time",
      poll !== undefined && poll.url.includes("poll=now") && poll.at - started < 2000,
    );
    check("pollHoldMs reaches the chat: each poll asks for that hold", poll !== undefined && poll.url.includes("wait=1234"));
    chat.close();
  }

  // the dock: a surface moves to the shelf and the window and back, mounted once
  {
    // init asks a question and shows a card; a message brings the card new props
    const opening = [
      { type: "hello", conversationId: "c1", model: "m", events: false },
      { type: "block_start", block: { kind: "tool", id: "t1", name: "pick_seat", input: {}, status: "awaiting" } },
      { type: "ui_open", handle: "h1", component: "picker", mode: "elicit", toolId: "t1" },
      { type: "ui_props", handle: "h1", props: { n: 1 } },
      { type: "block_start", block: { kind: "tool", id: "t2", name: "show_rules", input: {}, status: "ok", ms: 3 } },
      { type: "ui_open", handle: "h2", component: "rules", mode: "display", toolId: "t2" },
      { type: "ui_props", handle: "h2", props: { n: 1 } },
      { type: "status", status: "awaiting" },
    ];
    globalThis.fetch = async (url) =>
      String(url).endsWith("/start") ? sse(opening) : sse([{ type: "ui_props", handle: "h2", props: { n: 2 } }, { type: "status", status: "awaiting" }]);
    const mounts = { picker: 0, rules: 0 };
    const component = (name) => ({
      mount(el, props) {
        mounts[name]++;
        el.textContent = `${name} ${props.n}`;
      },
    });
    const registry = { picker: component("picker"), rules: component("rules") };
    const root = document.getElementById("app");
    const chat = mountChat({ root, registry });
    await wait(30);
    const q = (s) => root.querySelector(s);
    const card = () => q('.hai-dockable[data-handle="h1"]');
    const surface = card().querySelector(":scope > .hai-surface");
    const dockRules = q('[aria-label="Dock rules"]');
    check("each surface is in a card, with its name and a Dock button", card().querySelector(".hai-surface-name").textContent === "picker" && dockRules !== null);
    check("…an icon, named for screen readers and in a tooltip", dockRules.textContent === "" && dockRules.title === "Dock");
    check("nothing is docked yet: no shelf", q(".hai-dock").hidden && q(".hai-window").hidden);

    q('[aria-label="Dock picker"]').click();
    const back = card().querySelector('[aria-label="Put picker back"]');
    check("docked, the card leaves a stub and Put back in the surface's place", card().hasAttribute("data-docked") && card().textContent === "picker is in the dock" && card().querySelector(".hai-surface") === null && back?.title === "Put back");
    const item = q(".hai-dock-item");
    check("…and the shelf shows it, waiting on the reader", !q(".hai-dock").hidden && item.getAttribute("aria-label") === "picker, awaiting you" && item.dataset.status === "awaiting");
    check("the status line and the message box say the question is in the dock", q(".hai-status").textContent === "Waiting on your selection in the dock" && q(".hai-input").placeholder === "pick an option in the dock — or type to override");

    item.click();
    const win = q(".hai-window");
    check("a docked surface opens as a window: the same element, not mounted again", !win.hidden && win.contains(surface) && !surface.hidden && mounts.picker === 1);
    check("…named, with its tool and its status, and its item pressed", q(".hai-window-name").textContent === "picker" && q(".hai-window-tool").textContent === "· pick_seat" && q(".hai-window-badge").textContent === "awaiting you" && win.dataset.status === "awaiting" && item.getAttribute("aria-expanded") === "true");
    check("…and the reader is taken into it", document.activeElement === win);

    win.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape docks it again and returns to its item", win.hidden && document.activeElement === item && item.getAttribute("aria-expanded") === "false");

    item.click();
    const remove = q('[aria-label="Remove picker from the dock"]');
    check("the window's Remove from dock and Dock are icons too", remove.textContent === "" && remove.title === "Remove from dock" && q('[aria-label="Dock picker"].hai-bar-icon')?.closest(".hai-window") === win);
    remove.click();
    check("Remove from dock puts it back in its card, still mounted once", card().querySelector(":scope > .hai-surface") === surface && !card().hasAttribute("data-docked") && mounts.picker === 1);
    check("…and the shelf and the window go with the last docked", q(".hai-dock").hidden && win.hidden && q(".hai-status").textContent === "Waiting on your selection above");

    q('[aria-label="Dock rules"]').click();
    const input = q(".hai-input");
    input.value = "anything new?";
    q(".hai-send").click();
    await wait(30);
    const rules = q(".hai-dock-item");
    check("new props while docked and closed mark it changed", rules.getAttribute("aria-label") === "rules, changed" && !rules.querySelector(".hai-dock-changed").hidden);
    rules.click();
    check("…until it's opened", rules.getAttribute("aria-label") === "rules" && rules.querySelector(".hai-dock-changed").hidden);

    q(".hai-btn").click(); // New chat
    await wait(30);
    check("a new conversation empties the dock", root.querySelectorAll(".hai-dock-row .hai-dock-item").length === 0 && q(".hai-window").hidden && q(".hai-window-body").childElementCount === 0);
    chat.close();
  }

  // the pile: jsdom lays nothing out, so the shelf's row is given widths that
  // fit one item, and two surfaces of the same component are docked
  {
    globalThis.fetch = async (url) =>
      String(url).endsWith("/start")
        ? sse([
            { type: "hello", conversationId: "c3", model: "m", events: false },
            { type: "ui_open", handle: "h1", component: "rules", mode: "display" },
            { type: "ui_props", handle: "h1", props: { n: 1 } },
            { type: "ui_open", handle: "h2", component: "rules", mode: "display" },
            { type: "ui_props", handle: "h2", props: { n: 1 } },
          ])
        : sse([{ type: "ui_props", handle: "h1", props: { n: 2 } }]);
    const root = document.getElementById("app");
    const chat = mountChat({ root, registry: { rules: { mount: (el, props) => (el.textContent = `rules ${props.n}`) } } });
    await wait(30);
    const q = (s) => root.querySelector(s);
    const row = q(".hai-dock-row");
    Object.defineProperty(row, "scrollWidth", { get: () => [...row.children].filter((c) => !c.hidden).length * 100 });
    Object.defineProperty(row, "clientWidth", { get: () => 150 });
    const [h1, h2] = [...root.querySelectorAll('[aria-label="Dock rules"]')];
    h1.click();
    h2.click();
    const pileBtn = q(".hai-dock-pile > button");
    const shown = () => q(".hai-window-body > .hai-surface:not([hidden])")?.dataset.handle;
    check("a shelf with room for one piles the oldest", !q(".hai-dock-pile").hidden && pileBtn.textContent === "1 more");

    pileBtn.click();
    q(".hai-pile-row").click();
    check("a surface picked from the pile opens, and the next oldest takes its place there", shown() === "h1" && pileBtn.textContent === "1 more");
    pileBtn.click();
    q(".hai-pile-row").click();
    check("…and picking again opens the one piled now, though both are the same component", shown() === "h2");

    pileBtn.click();
    const before = document.activeElement;
    q(".hai-input").value = "anything new?";
    q(".hai-send").click();
    await wait(30);
    check("the pile's list keeps the reader's place when a row in it changes", before.classList.contains("hai-pile-row") && document.activeElement.classList.contains("hai-pile-row") && document.activeElement.getAttribute("aria-label") === "rules, changed");
    chat.close();
  }

  // dock: false keeps surfaces as renderTranscript draws them without onDock
  {
    globalThis.fetch = async () =>
      sse([
        { type: "hello", conversationId: "c2", model: "m", events: false },
        { type: "ui_open", handle: "h1", component: "rules", mode: "display" },
        { type: "ui_props", handle: "h1", props: { n: 1 } },
      ]);
    const root = document.getElementById("app");
    const chat = mountChat({ root, registry: { rules: { mount: (el) => (el.textContent = "rules") } }, dock: false });
    await wait(30);
    check("dock: false: no cards, no Dock buttons, no shelf", root.querySelector(".hai-surface") !== null && root.querySelector(".hai-dockable, .hai-dock, .hai-window") === null);
    chat.close();
  }
} finally {
  console.error = error;
}

console.log(failures ? `\nui: ${failures} failed` : "\nui: all checks passed");
process.exit(failures ? 1 : 0);
