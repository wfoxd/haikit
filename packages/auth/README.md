# @haikit/auth

Sign-in for haikit: who is asking, from a verified JWT, and which
conversations are theirs. Without it, a conversation id is all a request to
`nodeHandler` needs. With it, every route checks the user's token, and a
conversation someone else started is answered as one that doesn't exist.

It doesn't replace your login. Either your app checks the user its own way
and calls `signIn`, which issues a token as a cookie, or your identity
provider issues the tokens, and this checks them against its JWKS.

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
issued before it.

The whole reference is [Sign-in and ownership](../../docs/reference/auth.md).
