/**
 * The default UI (`mountChat`) in a DOM (jsdom), driven by a fetch that
 * answers with scripted event streams: it passes its polling options through
 * to the chat, and a message whose request fails comes back to the message
 * box, reported rather than left as an unhandled rejection.
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
} finally {
  console.error = error;
}

console.log(failures ? `\nui: ${failures} failed` : "\nui: all checks passed");
process.exit(failures ? 1 : 0);
