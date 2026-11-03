# hello-auth

Example app — not published. The finished app of the third tutorial,
*Who's asking* (`docs/tutorial-3.md`): [hello](../hello), signed in, so each
user sees only the conversations they started. It runs against the packages
in this repo, as hello does, on its own port so the two can run side by side.

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

To sign in with Google or GitHub as well, tutorial 3's step 10, register
the app with either, or both:

- **Google:** a Web-application OAuth client in the Google Cloud console, with
  the redirect URI `http://localhost:5176/auth/google/callback`.
- **GitHub:** an OAuth App, in GitHub's Developer settings, with the
  callback URL `http://localhost:5176/auth/github/callback`.

Then start it with the ids and secrets you have:

```bash
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… npm run example:hello-auth
```

`src/server/auth.ts` then passes `google()` from `@haikit/auth/oidc`, and
`github()` from `@haikit/auth/oauth2`, to `createAuth`, and `/sign-in` links
to `/auth/google` and `/auth/github`. Someone who signs in there is `google:`
or `github:` and the provider's id for them; `src/server/names.ts` keeps their
name, which `welcome` greets them by. `GOOGLE_REDIRECT_URI` and
`GITHUB_REDIRECT_URI` override the redirect URIs, as they must in production.

Sign in as two names in two browsers. A conversation id from one, sent by the
other, is answered `404 unknown conversation`. **Sign out everywhere**, on
`/sign-in`, calls `auth.revoke`: a copy of that user's token is refused from
then on.

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.
For production, set `HAIKIT_AUTH_SECRET` (`openssl rand -base64 32`), which
it then requires, and serve it over https: the cookie is `Secure` there.
