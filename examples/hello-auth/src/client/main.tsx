import "./globals.css";
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.tsx";

// Who is signed in, from the cookie: GET /auth/me. Asking also renews a
// cookie past half its life, so a page in use stays signed in.
const { user } = await fetch("/auth/me").then((r) => r.json());

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  title: "hello-auth",
  subtitle: user ? `signed in as ${user.id}` : "signed out",
  emptyText:
    "Only you can open this conversation: the server checks your sign-in on every request, and another user who has its id is told it doesn't exist.",
  suggestions: ["greet me", "which ones are right-to-left?"],
  // shown when the server turns the chat away, such as once the sign-in has expired
  signIn: { href: "/sign-in" },
});
