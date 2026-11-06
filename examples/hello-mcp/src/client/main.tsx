import "./globals.css";
import { mountChat } from "@haikit/client/app.js";
import { mountAccounts } from "./accounts.tsx";
import { notices, registry } from "./components.tsx";

// Who is signed in, from the cookie: GET /auth/me. Asking also renews a
// cookie past half its life, so a page in use stays signed in.
const { user } = await fetch("/auth/me").then((r) => r.json());

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  notices,
  title: "hello-mcp",
  subtitle: user ? `signed in as ${user.id}` : "signed out",
  emptyText:
    "Your notes, your calendar and the date, each from an MCP server, each as someone else: Notes as your own account there, Calendar with your own key, Almanac as this app.",
  suggestions: ["show my notes", "note: water the plants", "what's on my calendar?", "what day is it?"],
  // shown when the server turns the chat away, such as once the sign-in has expired
  signIn: { href: "/sign-in" },
});

// the settings panel: the accounts connected, and a way to disconnect them
mountAccounts(document.querySelector(".hai-actions"));
