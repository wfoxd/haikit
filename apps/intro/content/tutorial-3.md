# Who's asking

> The hello app from the first tutorial, signed in: each person sees only their own conversations, the model knows who it's talking to, and *sign out everywhere* does what it says. Nine steps, annotated line by line.

## Hello, who's asking — the app knows each person, and keeps them apart

In the first tutorial, a conversation's id was all a request needed. Anyone who had it could send to the conversation, click in it, and read what it showed. That's fine for one person on `localhost`. It isn't fine for an app on the internet, where every request has to answer two questions first: *who is asking?* and *is this conversation theirs?*

`@haikit/auth` answers both. It knows who's asking from a token, a signed JWT the browser sends with every request, and it remembers which conversations each person started. Then it stands in front of HaiKIT's routes as a **gate**: a request with no valid token is turned away before its body is read, and a conversation that isn't the asker's is answered as one that doesn't exist, before anything is loaded.

It doesn't replace your login. Checking a password, a passkey or an email link stays your code. What `@haikit/auth` does starts the moment that check has passed:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| **your login** | your server, your code | decides who someone is |
| **`auth.signIn`** | right after your login | issues a signed token, and sets it as a cookie |
| **`auth.gate`** | in front of `/hai` | lets a request in only with a valid token, and only to its own conversations |
| **`auth.ownerOf`** | in a tool | says whose conversation the tool is running in |
| **`auth.revoke`** | *sign out everywhere* | refuses every sign-in before now |

You need the app as the first tutorial left it, through step 08: the greeting picker, the greeting card, and the scripted model if you used it. Everything here runs in the same `haikit_hello/` folder. The second tutorial isn't needed, but if you did it, everything here works alongside it. The repo's `examples/hello-auth` is the finished app.

> [!NOTE]
> **A name, not a password**
>
> This tutorial's sign-in page asks only for a name, so you can sign in as anyone, and as two people at once. It stands in for your real login. Everything after it, the token, the gate and the ownership of conversations, is exactly what a real app runs.

## 01 · Install it

**`terminal`** — *run*

```bash
npm install @haikit/auth
```

> [!NOTE]
> **Needs HaiKIT 0.29 or later**
>
> The gate arrived in 0.29, in `@haikit/server` and `@haikit/client` as well as the new package. If your project installed an older release, update first: `npm install @haikit/core@latest @haikit/server@latest @haikit/client@latest @haikit/react@latest @haikit/anthropic@latest @haikit/auth@latest`. Upgrade them together, so they share one copy of `@haikit/core`.

## 02 · Create the auth object

One object holds everything `@haikit/auth` does: the gate, the sign-in, and the routes the browser asks. Make it in a file of its own, since the server and a tool will both need it.

**`src/server/auth.ts`** — *new file*

```ts
import { randomBytes } from "node:crypto";
import { createAuth, memoryAuthStore } from "@haikit/auth";

const PRODUCTION = process.env.NODE_ENV === "production";

// The secret tokens are signed with. Without one, a random secret for this run
// only: every sign-in ends when the server stops.
const SECRET = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));  // 1
if (!SECRET) throw new Error("set HAIKIT_AUTH_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");      // 2

export const auth = createAuth({
  // memoryAuthStore keeps owners in this process; pgAuthStore shares them
  store: memoryAuthStore(),                                 // 3
  jwt: { secret: SECRET },                                  // 4
  // Safari keeps no Secure cookie on http://localhost; in production, always Secure
  cookie: { secure: PRODUCTION },                           // 5
});
```

**1** The key every token is signed with, and checked against. Whoever has it can make a token for anyone, so it lives in the environment, never in the code. While you develop, a random one will do: it changes on every restart, which signs everyone out, and that's all.

**2** In production, no secret means no server. A secret made up at startup would sign everyone out on every deploy, and two servers would each have their own, refusing each other's tokens.

**3** Where the store keeps who owns which conversation, and when *sign out everywhere* last ran for each person. The tokens themselves are stored nowhere: they carry everything needed to check them. `memoryAuthStore` keeps this in one process, like `memoryStore`; *Before you ship it* swaps in Postgres.

**4** `signIn` signs its tokens with this, and the gate checks them with it. It must be at least 32 bytes, or `createAuth` refuses to start.

**5** The cookie is `Secure` by default: browsers send it only over https. Chrome and Firefox treat `http://localhost` as secure anyway, but Safari doesn't, so it's off while you develop.

To keep sign-ins across restarts, give it a secret of its own in `.env`. `npm start` loads that file already; to have `npm run mock` load it too, add the same `--env-file-if-exists=.env` to that script.

**`.env`** — *edit*

```bash
HAIKIT_AUTH_SECRET=paste the output of: openssl rand -base64 32
```

## 03 · Put the gate in front of the routes

**`src/server/main.ts`** — *edit*

```ts
import { auth } from "./auth.ts";

// The gate: only a signed-in user gets in, and only to conversations they started.
const handleHai = nodeHandler(hai, "/hai", { gate: auth.gate });   // 1
// GET /auth/me and POST /auth/sign-out
const handleAuth = auth.handler("/auth");                          // 2
```

and, in the server's request handler, straight after `handleHai`:

```ts
  if (await handleHai(req, res)) return;
  if (await handleAuth(req, res)) return;                          // 3
```

**1** Every route under `/hai` now asks the gate before it does anything else. Who's asking comes first, before the request's body is read, so a request without a valid token costs almost nothing. Then, if the request names a conversation, whether it's theirs, before it's loaded. A conversation that isn't theirs is answered `404 unknown conversation`, the same as one that doesn't exist, and a stranger never gets to hold it for even a moment.

**2** Two routes of its own: `GET /auth/me`, which says who is signed in, and `POST /auth/sign-out`. Like `handleHai`, it resolves `false` for anything else, so it composes with the rest of your server.

**3** Before Vite, which would otherwise answer every path it's asked for.

> [!TIP]
> **Checkpoint**
>
> Restart and reload. Nothing works, and that's the point: the transcript shows *sign in to continue*, and so does the status line under it. The chat asked to start a conversation, and the gate turned it away, because nobody has signed in. There's no way to yet. That's next.

## 04 · Sign in

Your login, as small as a login can be: a form that asks for a name. A real app checks a password, a passkey or an email link where this checks the name, then calls `auth.signIn` exactly as this does.

**`src/server/sign-in.ts`** — *new file*

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Auth } from "@haikit/auth";

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
  if (req.method === "GET") return page(res, await auth.user(req));                                  // 1
  if (req.method !== "POST") return void res.writeHead(405, { allow: "GET, POST" }).end();

  // A form from another site must not sign anyone in or out here, nor one
  // from a sandboxed frame or a file, whose origin is "null".
  const origin = req.headers.origin;
  if (origin !== undefined && !sameHost(origin, req.headers.host)) return void res.writeHead(403).end("forbidden");  // 2
  const form = new URLSearchParams(await body(req));

  const action = form.get("action");
  if (action === "out" || action === "revoke") {
    const user = await auth.user(req);
    if (user && action === "revoke") await auth.revoke(user.id);                                     // 3
    auth.signOut(res);                                                                                // 4
    return void res.writeHead(303, { location: "/sign-in" }).end();
  }
  const name = (form.get("name") ?? "").trim();
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(name)) return page(res, null, "A name of 1 to 40 letters, digits, spaces, dots, dashes or underscores.");  // 5
  await auth.signIn(res, name);                                                                       // 6
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
    if (text.length > 4_096) break;                                                                   // 7
  }
  return text;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);                // 8

function page(res: ServerResponse, user: { id: string } | null, problem = "") {
  const content = user
    ? `<p>Signed in as <strong>${escape(user.id)}</strong>.</p>
       <p><a href="/">Back to the chat</a></p>
       <form method="post"><button name="action" value="out">Sign out</button>
       <button name="action" value="revoke">Sign out everywhere</button></form>`
    : `<form method="post">
         <label>Your name <input name="name" autofocus required maxlength="40" autocomplete="username"></label>
         <button>Sign in</button>
       </form>
       ${problem ? `<p role="alert">${escape(problem)}</p>` : ""}
       <p>No password: this example shows what happens after the app's own login.</p>`;
  res.writeHead(problem ? 400 : 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
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
```

**1** `auth.user(req)` reads the request's token, from its cookie or an `Authorization: Bearer` header, checks it, and returns who it names, or `null`. Use it in any route of your own that needs to know.

**2** A page on another site can post a form here, and the browser would follow along. Without this check, it could sign your users out, or, worse, sign them in as someone else. The browser sends the page's origin with every post, and a page can't fake it.

**3** *Sign out everywhere.* Step 08 is about this one line.

**4** Clears this browser's cookie. The token itself still works until it expires, if anyone has a copy: that's what step 08 is for.

**5** The stand-in for your real check. Here it only makes sure the name is something sensible to show.

**6** The one call your login makes. It issues a token naming the user, signed with your secret and good for a week, and sets it on the response as a cookie that page scripts can't read (`HttpOnly`), and that the browser leaves off the requests other sites' pages make in the background (`SameSite=Lax`). From here on, the browser sends it with every request by itself. The name is the user's id here; in a real app, use your user's id from your database, which never changes, rather than a name, which might.

**7** A form with a name in it is small. Reading only so much keeps a request of any size from filling the server's memory.

**8** A name goes back into the page, so it's escaped. Someone could sign in as `<script>`.

Now send `/sign-in` there, and anyone who isn't signed in away from the chat. The request handler grows a little, so here it is whole:

**`src/server/main.ts`** — *edit*

```ts
import { signInPage } from "./sign-in.ts";

async function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  if (await handleHai(req, res)) return;
  if (await handleAuth(req, res)) return;
  // Node accepts targets a URL can't parse, such as `//[`; both handlers above leave them here
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");                            // 1
  } catch {
    return void res.writeHead(400).end("bad request");
  }
  if (url.pathname === "/sign-in") return signInPage(req, res, auth);              // 2
  // The chat page itself, to someone signed out: the sign-in page instead.
  if (url.pathname === "/" && !(await auth.user(req))) return void res.writeHead(303, { location: "/sign-in" }).end();  // 3

  if (vite) return vite.middlewares(req, res);
  const file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  // ...unchanged
}

// Whatever a request throws is answered and logged, never left to take the server down.
const server = http.createServer((req, res) =>
  serve(req, res).catch((err) => {                                                 // 4
    console.error("[hello-auth] request failed:", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }),
);
```

**1** Your server now reads every URL itself, not only the ones Vite hands back, and Node accepts some that `new URL` can't parse. Answer those instead of throwing.

**2** Before Vite, like `/auth`. Vite would answer `/sign-in` with the chat page.

**3** Only the page itself. Its scripts and styles, which Vite serves, don't need a sign-in, and `/hai` has its own gate.

**4** An `async` request handler that throws leaves a rejection nobody handles, and Node stops the whole server for one. The sign-in page reads a store and parses headers; this makes sure no request can take everyone else's down.

> [!TIP]
> **Checkpoint**
>
> Restart and open `http://localhost:5175`. You land on the sign-in page. Sign in as *ada*, and the chat opens as it always has: *“greet me”*, pick a language, and the turn finishes. The browser's developer tools show a cookie named `haikit_token`, marked *HttpOnly*: that's ada's token.

## 05 · Say who's signed in

The page can ask who's signed in, and tell the chat where to send someone whose sign-in has run out.

**`src/client/main.tsx`** — *edit*

```tsx
// Who is signed in, from the cookie: GET /auth/me. Asking also renews a
// cookie past half its life, so a page in use stays signed in.
const { user } = await fetch("/auth/me").then((r) => r.json());                   // 1

mountChat({
  root: document.querySelector<HTMLElement>("#app")!,
  registry,
  title: "hello-auth",
  subtitle: user ? `signed in as ${user.id}` : "signed out",
  emptyText:
    "Only you can open this conversation: the server checks your sign-in on every request, and another user who has its id is told it doesn't exist.",
  suggestions: ["greet me", "which ones are right-to-left?"],
  // shown when the server turns the chat away, such as once the sign-in has expired
  signIn: { href: "/sign-in" },                                                     // 2
});
```

**1** `{ user: { id, claims } }`, or `{ user: null }`. A token lasts a week, and nothing renews it by itself: asking `/auth/me` after half its life issues a fresh one, for the same sign-in. A page that asks as it opens stays signed in for as long as it's opened at least every three and a half days.

**2** When the server turns the chat away, because the sign-in has expired or been revoked, the status line says why, followed by this link. Whatever was typed stays in the message box, and the chat picks up again once a request goes through.

> [!TIP]
> **Checkpoint**
>
> Reload: the header says *signed in as ada*. Now open `http://localhost:5175/sign-in` in a second tab, and click **Sign out**. Back in the first tab, type *“greet me”* and send it. It doesn't go: the status line says *sign in to continue*, with **Sign in** beside it, and your message is back in the box. Sign in again, as ada, and the chat starts over, signed in.

## 06 · Tell the model who it's talking to

Who's signed in matters most to the tools. Booking, paying, or looking up an order all need to know whose. A tool doesn't see the request, but it knows its conversation, and the conversation knows its owner.

**`src/server/tools.ts`** — *append*

```ts
import { auth } from "./auth.ts";                     // with the other imports, at the top

/**
 * Runs as the conversation starts. The conversation is already its owner's,
 * so the tool asks who that is: in a wake turn too, where no request carries
 * a token.
 */
export const welcome = defineTool({
  name: "welcome",
  description: "Says who is signed in. Runs by itself as the conversation starts.",
  input: z.object({}),
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },

  async run(_input, ctx) {
    return ctx.text(`Signed in as ${await auth.ownerOf(ctx.conversationId)}.`);    // 1
  },
});
```

**1** `ownerOf` answers from the store, so it works wherever the conversation does: in a turn a click resumed three days later, and in a turn a notice started with nobody's request behind it, if you did the second tutorial. The gate made the conversation its creator's before the browser was even told its id, so `init`, which runs right after, always finds an owner.

Make it the conversation's `init`, the tool the runtime runs itself before the model's first turn, and tell the model what it says:

**`src/server/main.ts`** — *edit*

```ts
import { tools, welcome } from "./tools.ts";

const hai = createHai({
  init: welcome,                                                                    // 1
  system: `You greet people in their chosen language through a UI that renders
tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the
user's browser, addressable by the handle in the digest (e.g. ui_01).

- welcome has already run, and says who is signed in. Use their name.             // 2
- Never state a specific fact about languages you have not seen. Use
  query_ui. Do not guess.
- list_greetings renders a picker and blocks until the user chooses. The
  component is the question — do not also ask them to type one.
- Once they choose, greet them in that language and stop.`,
  // ...model, store, tools and surfaces unchanged
});
```

**1** Leave it out of `tools`: `init` registers it. If you added `load_profile` from the first tutorial's *Where to go next*, this is the identity it was waiting for. Keep one `init`, and have it look up the profile of `await auth.ownerOf(ctx.conversationId)` instead of a constant.

**2** The model reads `welcome`'s result like any tool result. Saying it's there, and what to do with it, keeps the model from asking for a name it already has.

If you're running the scripted model, one change lets it greet you by name, reading it from the history as Claude would:

**`src/server/scripted.ts`** — *edit, if you're using it*

```ts
// in the greeting branch, use the name welcome found
if (/greet|hello|hi\b|hey|language|world|start/.test(text)) {
  // the name welcome found, as any model would read it from the history
  const name = JSON.stringify(messages).match(/Signed in as (.+?)\."/)?.[1];
  const line = name ? `Hi ${name}! Pick a language.` : "Pick a language.";
  onTextDelta(line);
  return {
    content: [
      { type: "text", text: line },
      toolUse("list_greetings", {}),
    ],
    stop_reason: "tool_use",
  };
}
```

> [!TIP]
> **Checkpoint**
>
> Restart, sign in again if the restart signed you out, and reload. Before you type anything, a **welcome** row appears; open it, and its result is *Signed in as ada.* Say *“greet me”*: the reply starts *Hi ada!* Open **Context**: the model got the name from `welcome`, and nowhere else.

## 07 · Keep conversations apart

Sign in as someone else, and the gate keeps each person to their own conversations. To see it refuse, you need to try one that isn't yours, which the page itself never does. So try it from a terminal.

First, find ada's conversation. In her tab, open the developer tools' **Network** panel and reload. Click the request named `start`, then its **Response**: the first line is `hello`, and it carries the `conversationId`, something like `conv_1_9c41…`. Copy it.

Then sign in as bob with `curl`, keeping his cookie in a file, and ask for ada's conversation:

**`terminal`** — *run*

```bash
curl -s -o /dev/null -c bob.txt -H "Origin: http://localhost:5175" -d name=bob http://localhost:5175/sign-in
curl -s -b bob.txt -H "Origin: http://localhost:5175" -H "content-type: application/json" \
  -d '{"conversationId":"PASTE ADA'S ID HERE","message":"whose is this?"}' http://localhost:5175/hai/chat
```

> [!TIP]
> **Checkpoint**
>
> Bob is told `{"error":"unknown conversation"}`, exactly what he'd be told for an id that never existed, so he learns nothing, not even that it's real. Back in ada's tab, send another message: it goes straight through. Bob's request was turned away before the conversation was loaded, so it never held ada's conversation, even for a moment.

Conversation ids are as unguessable as ever. The difference is that one is no longer enough: a request needs the id *and* its owner's sign-in.

## 08 · Sign out everywhere

**Sign out** in step 05 cleared one browser's cookie. That's all it can do. A token is a signed statement, *“this is ada, until next Thursday”*, and anyone holding a copy can keep showing it until then. A copy is exactly what you'd worry about: a phone left logged in, a laptop that was stolen, a cookie that leaked.

`auth.revoke(ada)` is what the **Sign out everywhere** button calls. It stores the time, and from then on the gate refuses every token from a sign-in before it, whoever holds it.

To see it, make a copy of ada's sign-in with `curl`, and check it works:

**`terminal`** — *run*

```bash
curl -s -o /dev/null -c ada.txt -H "Origin: http://localhost:5175" -d name=ada http://localhost:5175/sign-in
curl -s -b ada.txt http://localhost:5175/auth/me
```

> [!TIP]
> **Checkpoint**
>
> The second line answers with `"id":"ada"`. Now, in ada's browser, go to `/sign-in` and click **Sign out everywhere**. Ask again with the copy: `{"user":null}`. It's refused on `/hai` as well, with *your sign-in has expired or is invalid*. Sign in as ada in the browser once more, and that works: a sign-in after the revocation is a new one.

On one server, the refusal is immediate. With several, each one reads the time within 30 seconds; an events stream already open, from the second tutorial, ends at its next check, within a minute and a half at most. A token `/auth/me` renewed carries the time of the sign-in it renewed, so renewing a stolen cookie doesn't get it past a revocation.

## 09 · Break it on purpose

**Take the gate out.** In `main.ts`, change the routes back to `nodeHandler(hai, "/hai")` and restart. Sign in as ada again in the browser, copy her new conversation's id as in step 07, and send bob's `curl` again:

```bash
curl -s -o /dev/null -c bob.txt -H "Origin: http://localhost:5175" -d name=bob http://localhost:5175/sign-in
curl -s -b bob.txt -H "Origin: http://localhost:5175" -H "content-type: application/json" \
  -d '{"conversationId":"PASTE ADA'S ID HERE","message":"whose is this?"}' http://localhost:5175/hai/chat
```

It goes through: a stream of events, and the model answering bob in ada's conversation. Ada's tab shows nothing yet, since a page only hears the streams of its own requests, but send her anything and open **Context**: bob's *whose is this?* is in her history. Without the gate, the id was the only key. Put `{ gate: auth.gate }` back and restart.

**Post from somewhere else.** Sign in as ada with `curl` again, as in step 08. Then send her cookie the way a page on another site would:

```bash
curl -s -b ada.txt -H "Origin: https://elsewhere.example" -H "content-type: application/json" \
  -d '{"message":"hi"}' http://localhost:5175/hai/chat
curl -s -b ada.txt -H "Origin: http://localhost:5175" -H "content-type: text/plain" \
  -d '{"message":"hi"}' http://localhost:5175/hai/chat
```

The first is refused with *this request came from another site* (403): the cookie came from a page that isn't yours. The second is refused with *the request body must be sent as application/json* (415): a form on another site can send `text/plain`, but not `application/json` without asking the server first, which HaiKIT never agrees to.

**Use a short secret.** Stop the server and start it with `HAIKIT_AUTH_SECRET=short npm run mock`. It doesn't start: `createAuth: each jwt secret must be at least 32 bytes`. A short secret can be guessed, and then anyone can sign in as anyone.

> [!TIP]
> **What you just proved**
>
> The gate, not the conversation id, decides who gets in, and it decides before anything is read. A signed-in user's cookie only works from your own pages. And a configuration that would make tokens forgeable stops the server rather than running weakly.

## Where to go next

The hello app now knows who everyone is: it signs them in, keeps them to their own conversations, tells the model their name, and signs them out everywhere at once.

### Before you ship it

- **Set `HAIKIT_AUTH_SECRET`** on every server, the same on each: `openssl rand -base64 32`. To change it without signing everyone out, give `jwt.secret` an array: the first signs new tokens, and every one checks them, so the old one can stay until its tokens have expired.
- **Keep owners in Postgres.** `memoryAuthStore` forgets on a restart and isn't shared. If you use `@haikit/postgres`, the same pool serves both:

  ```ts
  import { pgAuthStore, migrate as migrateAuth } from "@haikit/auth/postgres";

  await migrateAuth(pool); // creates its two tables if they don't exist
  export const auth = createAuth({ store: pgAuthStore(pool), jwt: { secret: SECRET } });
  ```

- **Serve it over https.** In production the cookie is `Secure` and named `__Host-haikit_token`, so the browser sends it only over https, and only to the host that set it.
- **Put your real login where step 04 checks the name.** And call `auth.revoke(userId)` whenever a user changes their password, or tells you a device is lost.
- **Behind a proxy that rewrites the `Host` header,** list your public origin, such as `origins: ["https://hello.example.com"]`, so cookie requests from your own pages aren't mistaken for another site's.

### Use your identity provider instead

If your users already sign in with Auth0, Clerk, Cognito, Supabase or anyone else that issues JWTs, skip step 02's secret and step 04's page. Check their tokens against your provider's published keys instead:

```ts
export const auth = createAuth({
  store: pgAuthStore(pool),
  jwt: {
    jwks: "https://YOUR_TENANT/.well-known/jwks.json",
    issuer: "https://YOUR_TENANT/",
    audience: "YOUR_API",
  },
});
```

The browser sends the provider's token with each request, fresh each time, through `mountChat`'s `fetch`:

```ts
mountChat({
  // ...
  fetch: async (url, init) =>
    fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await getToken()}` } }),
});
```

`getToken()` is your provider's call for a current access token. The gate, `ownerOf` and the 404 for someone else's conversation all work as before. `signIn` and *sign out everywhere* are your provider's to do.

### Conversations from before sign-in

A conversation made before you added the gate has no owner, so the gate tells everyone it doesn't exist. If you know whose one is, `auth.claim(conversationId, userId)` makes it theirs. Don't give one to whoever asks for it first: a conversation id may have been seen by others.

### Things that will tempt you

**Taking the user's identity from what they type, or from a tool's input.** The model can be talked into passing along anything, but it can't change whose conversation it's in. Identity comes from `ownerOf(ctx.conversationId)`, never from the conversation's content.

**Putting one user's data in a signal.** A signal still goes to every open browser, everyone's. The gate keeps conversations apart, not broadcasts.

**`cookie: { secure: false }` in production, or trusting a forwarded host.** Both exist for one reason each, `http://localhost` in Safari, and a proxy you've listed in `origins`. Anywhere else, they're a way around the protections in step 09.

The whole of `@haikit/auth` is in the reference manual: [Sign-in and ownership](reference/auth.md). How the gate fits into the routes is under [Gates](reference/http.md#gates).
