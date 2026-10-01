import "@haikit/client/hai.css";
import "./styles.css";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.tsx";

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  title: "hello, in React",
  subtitle: "the same surfaces as hello, written as React components",
  emptyText:
    "One tool execution, two channels: a short digest for the model, the full payload for this browser. Watch the right pane.",
  suggestions: ["greet me", "which ones are right-to-left?"],
});
