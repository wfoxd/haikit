import "./globals.css";
import { mountChat } from "@haikit/client/app.js";
import { notices, registry } from "./components.tsx";

// Who is signed in, from the cookie: GET /auth/me. Asking also renews a
// cookie past half its life, so a page in use stays signed in.
const { user } = await fetch("/auth/me").then((r) => r.json());

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  notices,
  title: "hello-github",
  // a name, from Google or GitHub, if they signed in with one
  subtitle: user ? `signed in as ${user.claims.name ?? user.id}` : "signed out",
  emptyText:
    "Greetings, and GitHub's issues, read as you: connect your GitHub account once, and every conversation of yours can search it.",
  suggestions: ["greet me", "find issues about hebrew in haikit-demo/greetings", "read issue 12 in haikit-demo/greetings"],
  // shown when the server turns the chat away, such as once the sign-in has expired
  signIn: { href: "/sign-in" },
});
