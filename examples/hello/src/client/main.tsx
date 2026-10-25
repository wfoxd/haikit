import "./globals.css";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.tsx";

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  title: "hello",
  subtitle: "tools return UI context, the transcript renders it",
  emptyText:
    "One tool execution, two channels: a short digest for the model, the full payload for this browser. Open Context, top right, to see what the model gets.",
  suggestions: ["greet me", "which ones are right-to-left?"],
});
