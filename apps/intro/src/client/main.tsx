import "./globals.css";
import { createRoot } from "react-dom/client";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.tsx";
import { Menu, type MenuData } from "./menu.tsx";
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

// The menu bar under the header: Home, Tutorial, Lesson, Reference and Demo.
// Its choices are chat messages, so it needs only the chat and the list of
// what to offer.
const menu: MenuData | null = await fetch("/menu.json")
  .then((r) => r.json())
  .catch(() => null);
if (menu) {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Introduction");
  nav.className = "relative z-20 flex h-[42px] flex-none items-center gap-0.5 border-b border-hai-line bg-hai-panel pr-2.5 pl-1.5";
  // just under the header; at the top if a later mountChat draws no header
  const top = root.querySelector(".hai-top");
  if (top) top.after(nav);
  else root.prepend(nav);
  createRoot(nav).render(<Menu chat={chat} data={menu} />);
}
