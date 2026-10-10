/**
 * @haikit/react against a real React and a DOM (jsdom): a surface component
 * renders on mount, sends only through ctx.send, keeps its own state through a
 * freeze, and cleans up its effects when unmounted. And under the default
 * transcript, which renders on every event, it mounts once.
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
for (const name of ["Node", "HTMLElement", "Event", "MouseEvent"]) globalThis[name] = dom.window[name];
// tells React that updates here are flushed through act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement: h, useEffect, useState, act } = await import("react");
const { reactSurface, reactNotice } = await import("../packages/react/dist/index.js");
const { renderTranscript } = await import("../packages/client/src/transcript.js");

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}`);
  if (!ok) failures++;
};

// a picker with state of its own (an expanded list) and an effect to clean up
let effects = 0;
let cleanups = 0;
function Picker({ props, send, state, selection, expired }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    effects++;
    return () => cleanups++;
  }, []);
  const shown = expanded ? props.items : props.items.slice(0, 1);
  return h(
    "div",
    { "data-state": state, "data-expired": String(expired) },
    h("button", { className: "more", onClick: () => setExpanded(true) }, "more"),
    ...shown.map((item) =>
      h("button", { key: item, className: "item", disabled: state !== "live", onClick: () => send("choose", item) }, item),
    ),
    selection ? h("p", { className: "picked" }, `picked ${selection}`) : null,
  );
}

console.log("\n@haikit/react");
const def = reactSurface(Picker);
const sent = [];
const ctx = { handle: "ui_01", mode: "elicit", state: "live", send: async (action, value) => void sent.push([action, value]) };
const el = document.createElement("div");
document.body.append(el);

let instance;
await act(async () => {
  instance = def.mount(el, { items: ["a", "b", "c"] }, ctx);
});
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("it renders into the surface's element", el.querySelectorAll("button.item").length === 1);

await act(async () => click(el.querySelector("button.more")));
await act(async () => click([...el.querySelectorAll("button.item")].at(-1)));
check("a click sends the declared action and its value through ctx.send", JSON.stringify(sent) === '[["choose","c"]]');

await act(async () => instance.freeze("c"));
check(
  "freeze() re-renders it frozen with the selection, its own state intact",
  el.firstElementChild.dataset.state === "frozen" &&
    el.querySelector(".picked")?.textContent === "picked c" &&
    el.querySelectorAll("button.item").length === 3,
);

await act(async () => instance.expire());
check("expire() re-renders it as out of date", el.firstElementChild.dataset.expired === "true");

await act(async () => instance.unmount());
check("unmount() runs its effects' cleanups and empties the element", cleanups === 1 && el.childNodes.length === 0);

// mounted again once it is answered, as reset() or a remount would leave it
const frozenEl = document.createElement("div");
let frozenInstance;
await act(async () => {
  frozenInstance = def.mount(frozenEl, { items: ["a", "b"] }, { ...ctx, state: "frozen", selection: "b" });
});
check(
  "mounted already answered, it renders frozen with what was picked",
  frozenEl.firstElementChild.dataset.state === "frozen" && frozenEl.querySelector(".picked")?.textContent === "picked b",
);
await act(async () => frozenInstance.unmount());

// the first render is synchronous: the surface has height when the
// transcript scrolls to it. Mounted as a browser would, with no act()
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const sync = document.createElement("div");
const syncInstance = def.mount(sync, { items: ["x"] }, ctx);
check("the first render is there as soon as mount() returns", sync.querySelectorAll("button.item").length === 1);
syncInstance.unmount();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── under the default transcript, which renders on every event
effects = 0;
const registry = { picker: def };
const surfaces = new Map([["ui_02", { component: "picker", props: { items: ["a"] } }]]);
const chat = {
  state: { blocks: [{ kind: "ui", id: "ui:ui_02", handle: "ui_02" }], surfaces },
  mount: (handle, element) => {
    const s = surfaces.get(handle);
    return (s.instance = registry[s.component].mount(element, s.props, { ...ctx, handle }));
  },
};
const root = document.createElement("div");
document.body.append(root);
const reply = { kind: "assistant", id: "b1", text: "" };
chat.state.blocks.push(reply);
for (const chunk of ["One, ", "two, ", "three."]) {
  reply.text += chunk;
  await act(async () => renderTranscript(root, chat));
}
check("under the default transcript a React surface mounts once while a reply streams", effects === 1);
await act(async () => surfaces.get("ui_02").instance.unmount());

// ── a revision: new props, the component's own state kept
{
  function Fare({ props }) {
    const [open, setOpen] = useState(false);
    return h("div", null, h("button", { className: "open", onClick: () => setOpen(true) }, "open"), h("p", { className: "fare" }, `${props.price} ${open ? "open" : "closed"}`));
  }
  const fareEl = document.createElement("div");
  document.body.append(fareEl);
  let fare;
  await act(async () => {
    fare = reactSurface(Fare).mount(fareEl, { price: 343 }, { handle: "ui_01", mode: "display", state: "live", send: async () => {} });
  });
  await act(async () => click(fareEl.querySelector("button.open")));
  await act(async () => fare.update({ price: 389 }));
  check("update() re-renders a React surface with the new props, keeping its own state", fareEl.querySelector("p.fare")?.textContent === "389 open");
  await act(async () => fare.unmount());
}

// ── a notice: rendered from its payload, with nothing to send
{
  let noticeCleanups = 0;
  function Held({ payload, seq, handle }) {
    useEffect(() => () => void noticeCleanups++, []);
    return h("p", { className: "held", "data-seq": seq, "data-handle": handle }, `${payload.flight} is held`);
  }
  const noticeEl = document.createElement("div");
  document.body.append(noticeEl);
  let held;
  await act(async () => {
    held = reactNotice(Held).mount(noticeEl, { flight: "AC832" }, { seq: 4, version: 1, handle: "ui_01" });
  });
  const p = noticeEl.querySelector("p.held");
  check(
    "a React notice renders its payload, seq and handle as soon as mount() returns",
    p?.textContent === "AC832 is held" && p.dataset.seq === "4" && p.dataset.handle === "ui_01",
  );
  await act(async () => held.unmount());
  check("unmount() cleans up a React notice", noticeCleanups === 1 && noticeEl.childNodes.length === 0);
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nreact: all checks passed\n");
process.exit(failures ? 1 : 0);
