# @haikit/auth

Sign-in for haikit: who is asking, from a verified JWT, and which
conversations are theirs. Without it, a conversation id is all a request to
`nodeHandler` needs. With it, every route checks the user's token, and a
conversation someone else started is answered as one that doesn't exist.

It doesn't replace your login. Either your app checks the user its own way
and calls `signIn`, which issues a token as a cookie, or your identity
provider issues the tokens, and this checks them against its JWKS. Or users
sign in with Google, GitHub, or any OpenID Connect or OAuth 2.0 provider, and
this calls `signIn` for you.

```ts
import { createHai, nodeHandler } from "@haikit/server";
import { createAuth, memoryAuthStore } from "@haikit/auth";

const auth = createAuth({ store: memoryAuthStore(), jwt: { secret: process.env.HAIKIT_AUTH_SECRET } });
const routes = nodeHandler(hai, "/hai", { gate: auth.gate });
const authRoutes = auth.handler("/auth"); // GET /auth/me, POST /auth/sign-out

// after your own login has checked the user:
await auth.signIn(res, userId);
```

## An identity provider's tokens

```ts
const auth = createAuth({
  store,
  jwt: { jwks: "https://example.us.auth0.com/.well-known/jwks.json", issuer: "https://example.us.auth0.com/", audience: "my-api" },
});
```

In the browser, send the provider's token with each request:

```ts
mountChat({
  root,
  registry,
  fetch: async (url, init) => fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await getToken()}` } }),
});
```

## Sign in with Google

```ts
import { google } from "@haikit/auth/oidc";

const auth = createAuth({
  store,
  jwt: { secret: process.env.HAIKIT_AUTH_SECRET },
  providers: [
    google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: "https://app.example.com/auth/google/callback", // as registered with Google
      failureUrl: "/sign-in", // a failed sign-in comes back here, with ?sign_in_error=
    }),
  ],
});
```

A link to `/auth/google` sends the browser to Google, and the user Google
names on the way back is signed in with `signIn`, as `google:` and Google's
id for them. The code flow carries PKCE, a `state` and a `nonce`, in an
encrypted cookie that lasts 10 minutes. `user(profile)` maps someone to
your own user id, or refuses them; `hostedDomain` keeps it to one Google
Workspace domain. Any other OpenID Connect provider works the same through
`oidc({ name, issuer, clientId, clientSecret, redirectUri })`.

## Sign in with GitHub

```ts
import { github } from "@haikit/auth/oauth2";

const auth = createAuth({
  store,
  jwt: { secret: process.env.HAIKIT_AUTH_SECRET },
  providers: [
    github({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      redirectUri: "https://app.example.com/auth/github/callback", // the OAuth App's callback URL
    }),
  ],
});
```

A link to `/auth/github` sends the browser to GitHub. GitHub doesn't speak
OpenID Connect, so there's no ID token: the code is exchanged for an access
token, the user is read from GitHub's API with it, and the token is dropped.
They sign in as `github:` and their GitHub id, with their name and their
verified primary email. Any other OAuth 2.0 provider works through
`oauth2({ name, authorizationEndpoint, tokenEndpoint, clientId, clientSecret, redirectUri, profile })`,
where `profile(api)` reads who signed in with `api.get`.

## In a tool

```ts
run: async (input, ctx) => {
  const userId = await auth.ownerOf(ctx.conversationId); // in a wake turn too
  // …
},
```

## With several servers

`memoryAuthStore` keeps owners in one process. `pgAuthStore` keeps them in
Postgres, on the same driver as `@haikit/postgres`:

```ts
import { pgAuthStore, migrate } from "@haikit/auth/postgres";

await migrate(pool);
const auth = createAuth({ store: pgAuthStore(pool), jwt: { secret } });
```

Tokens are stateless: the store holds only who owns which conversation, and
when `revoke` was last called for a user, which refuses every token they were
issued before it, renewals of an earlier sign-in included.

*Who's asking*, the [third tutorial](../../docs/tutorial-3.md), adds it to the
first tutorial's app step by step. The whole reference is
[Sign-in and ownership](../../docs/reference/auth.md).
