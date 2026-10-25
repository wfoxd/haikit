import "./styles.css";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.js";
import { mountMenu } from "./menu.js";

const root = /** @type {HTMLElement} */ (document.querySelector("#app"));

// Which HaiKIT this server runs, read from its packages at startup.
const about = await fetch("/version.json").then((r) => r.json()).catch(() => null);

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
  registry, // welcome, course_map, lesson, checkpoint
  title: "Introducing HaiKIT",
  subtitle: about ? `built with HaiKIT ${about.haikit}` : "built with HaiKIT",
  placeholder: "a lesson number, “next”, or “what is a digest?”",
});
// #endregion mount

// The menu bar under the header: Home, Tutorial and Lesson. Its choices are chat
// messages, so it needs only the chat and the list of what to offer.
const menu = await fetch("/menu.json").then((r) => r.json()).catch(() => null);
if (menu) mountMenu(root, chat, menu);

// How many people are reading now: the server's `online` signal, a
// broadcast to every open tab. It never enters the transcript or the
// guide's context; a chip in the header shows the latest count.
const reading = document.createElement("span");
reading.className = "online-chip";
reading.hidden = true;
root.querySelector(".hai-actions")?.prepend(reading);
const showReading = (/** @type {typeof chat.state} */ state) => {
  const count = /** @type {{ count?: number } | undefined} */ (state.signals.online)?.count ?? 0;
  reading.hidden = count < 1;
  reading.textContent = `${count} reading now`;
  reading.title = count === 1 ? "You're the only one here right now" : `${count} people have the introduction open`;
};
chat.subscribe((state, event) => {
  if (event.type === "signal" && event.name === "online") showReading(state);
});
// A count may have come while the menu loaded: subscribers hear only what comes next.
showReading(chat.state);
