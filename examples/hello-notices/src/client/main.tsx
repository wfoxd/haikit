import "./globals.css";
import { mountChat } from "@haikit/client/app.js";
import { notices, registry } from "./components.tsx";

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  notices,
  title: "hello",
  subtitle: "the server speaks up after the request is over",
  emptyText:
    "Pick a greeting and it goes out as a postcard. Its delivery, the reply, and new translations arrive later, on their own.",
  suggestions: ["greet me", "did my postcard arrive?"],
});
