# hello-auth

Example app — not published. [hello](../hello), signed in: each user sees only
the conversations they started. It runs against the packages in this repo,
as hello does.

Run from the repo root:

```bash
npm run example:hello-auth   # http://localhost:5176
```

Signed out, the page sends you to `/sign-in`, which asks only for a name: no
password, since what this shows is what happens after the app's own login.
`src/server/sign-in.ts` checks the name and calls `auth.signIn`, which sets a
token as a cookie. From then on, `@haikit/auth`'s gate checks it on every
request to `/hai`:

- `src/server/auth.ts` makes the `Auth`, signing tokens with
  `HAIKIT_AUTH_SECRET`, or with a random secret for this run when it isn't
  set, so a restart signs everyone out.
- `src/server/main.ts` passes `auth.gate` to `nodeHandler`, and serves
  `auth.handler("/auth")`: `GET /auth/me` and `POST /auth/sign-out`.
- `welcome`, in `src/server/tools.ts`, runs as each conversation starts and
  asks `auth.ownerOf(ctx.conversationId)` who it's for.
- The page asks `/auth/me` who is signed in, which also renews a cookie past
  half its life, and passes `signIn: { href: "/sign-in" }` to `mountChat`. A
  request turned away then says why in the status line, with a link to sign in.

Sign in as two names in two browsers. A conversation id from one, sent by the
other, is answered `404 unknown conversation`. **Sign out everywhere**, on
`/sign-in`, calls `auth.revoke`: a copy of that user's token is refused from
then on.

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.
For production, set `HAIKIT_AUTH_SECRET` (`openssl rand -base64 32`), which
it then requires, and serve it over https: the cookie is `Secure` there.
