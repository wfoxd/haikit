import type { IncomingMessage, ServerResponse } from "node:http";
import type { Auth } from "@haikit/auth";
import { withGoogle } from "./auth.ts";

/**
 * The app's own login, as small as one can be: a name, and no password. A
 * real app checks a password, a passkey or an email link here, then calls
 * `auth.signIn` exactly as this does. Everything after that is @haikit/auth's.
 *
 *   GET  /sign-in                  the form, or who is signed in
 *   POST /sign-in   name=…          sign in as that name
 *   POST /sign-in   action=out      sign out of this browser
 *   POST /sign-in   action=revoke   sign out everywhere: every sign-in before now is refused
 */
export async function signInPage(req: IncomingMessage, res: ServerResponse, auth: Auth) {
  if (req.method === "GET") {
    const why = new URL(req.url ?? "/", "http://localhost").searchParams.get("sign_in_error");
    return page(res, await auth.user(req), SIGN_IN_ERRORS.get(why ?? "") ?? "", 200);
  }
  if (req.method !== "POST") return void res.writeHead(405, { allow: "GET, POST" }).end();

  // A form from another site must not sign anyone in or out here, nor one
  // from a sandboxed frame or a file, whose origin is "null".
  const origin = req.headers.origin;
  if (origin !== undefined && !sameHost(origin, req.headers.host)) return void res.writeHead(403).end("forbidden");
  const form = new URLSearchParams(await body(req));

  const action = form.get("action");
  if (action === "out" || action === "revoke") {
    const user = await auth.user(req);
    if (user && action === "revoke") await auth.revoke(user.id);
    auth.signOut(res);
    return void res.writeHead(303, { location: "/sign-in" }).end();
  }
  const name = (form.get("name") ?? "").trim();
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) return page(res, null, "A name of 1 to 40 letters, digits, spaces, dots, dashes or underscores.");
  await auth.signIn(res, name);
  res.writeHead(303, { location: "/" }).end();
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4_096) break;
  }
  return text;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** What each way a sign-in through Google can fail means to the person trying. */
const SIGN_IN_ERRORS = new Map([
  ["access_denied", "Signing in with Google was cancelled."],
  ["refused", "That Google account can't sign in here."],
  ["expired", "That sign-in took too long, or had ended already. Try again."],
  ["failed", "Signing in with Google didn't work. Try again in a moment."],
]);

function page(res: ServerResponse, user: { id: string } | null, problem = "", status = problem ? 400 : 200) {
  const content = user
    ? `<p>Signed in as <strong>${escape(user.id)}</strong>.</p>
       <p><a href="/">Back to the chat</a></p>
       <form method="post"><button name="action" value="out">Sign out</button>
       <button name="action" value="revoke">Sign out everywhere</button></form>`
    : `<form method="post">
         <label>Your name <input name="name" autofocus required maxlength="40" autocomplete="username"></label>
         <button>Sign in</button>
       </form>
       ${withGoogle ? `<p><a href="/auth/google">Sign in with Google</a></p>` : ""}
       ${problem ? `<p role="alert">${escape(problem)}</p>` : ""}
       <p>No password: this example shows what happens after the app's own login.</p>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — hello-auth</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 28rem; margin: 15vh auto; padding: 0 16px; line-height: 1.5; }
    input, button { font: inherit; padding: 6px 10px; }
    label { display: grid; gap: 4px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>hello-auth</h1>
  ${content}
</body>
</html>`);
}
