import "./styles.css";
import { mountChat } from "@haikit/client/app.js";
import { notices, registry } from "./components.js";

mountChat({
  root: /** @type {HTMLElement} */ (document.querySelector("#app")),
  registry,
  notices,
  title: "flights",
  subtitle: "tools return UI context, the transcript renders it",
  emptyText:
    "One tool execution, two channels: a short digest for the model, the full payload for this browser. Open Context, top right, to see what the model gets.",
  suggestions: [
    "find me flights to Tokyo next Friday",
    "any nonstops under $500?",
    "show me the seat map",
  ],
});
