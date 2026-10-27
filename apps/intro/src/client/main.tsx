import "./globals.css";
import { createRoot } from "react-dom/client";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.tsx";
import { Contents, type MenuData } from "./contents.tsx";
import { Online } from "./online.tsx";

const root = document.querySelector<HTMLElement>("#app")!;

// Which HaiKIT this server runs, read from its packages at startup.
const about: { haikit: string } | null = await fetch("/version.json")
  .then((r) => r.json())
  .catch(() => null);

// Watching the model's context is half the course, so a first visit opens
// the context drawer. The client remembers it under this documented key
// and restores it on wide screens only; once a learner opens or closes
// it, their choice stands.
try {
  if (localStorage.getItem("hai:debug-drawer") === null) localStorage.setItem("hai:debug-drawer", "open");
} catch {}

// #region mount
const chat = mountChat({
  root,
  registry, // welcome, course_map, lesson, checkpoint…
  title: "Introducing HaiKIT",
  subtitle: about ? `built with HaiKIT ${about.haikit}` : "built with HaiKIT",
  placeholder: "a lesson number, “next”, or “what is a digest?”",
});
// #endregion mount

// How many people are reading now: a chip at the start of the header's
// actions. mountChat draws the header, so the chip is a React root of its own.
const actions = root.querySelector(".hai-actions");
if (actions) {
  const chip = document.createElement("span");
  chip.className = "contents";
  actions.prepend(chip);
  createRoot(chip).render(<Online chat={chat} />);
}

// The contents rail beside the chat: the welcome screen, the course map,
// every lesson, tutorial page and reference page, and the demos. Its choices
// are chat messages, so it needs only the chat and the list of what to offer.
// mountChat draws the shell, so the rail takes a slot at the start of its main
// grid, and its button a place at the start of the header.
const menu: MenuData | null = await fetch("/menu.json")
  .then((r) => r.json())
  .catch(() => null);
const grid = root.querySelector<HTMLElement>(".hai-main");
if (menu && grid) {
  const slot = document.createElement("div");
  slot.className = "intro-rail";
  grid.prepend(slot);
  const button = document.createElement("span");
  button.className = "contents";
  // a later mountChat that draws no header leaves the rail its column alone
  root.querySelector(".hai-top")?.prepend(button);
  createRoot(slot).render(<Contents chat={chat} data={menu} main={grid} button={button} />);
}
