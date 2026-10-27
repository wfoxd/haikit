# Sign-in and ownership

`@haikit/auth` says who is asking, from a verified JWT, and lets each user
use only the conversations they started. It makes a [gate](http.md#gates)
for `nodeHandler`, so every route checks the user's token, and a
conversation that isn't theirs is answered as one that doesn't exist. It
doesn't replace the app's own login. Either the app checks the user its own
way and calls `signIn`, which issues a token as a cookie, or the app's
identity provider (Auth0, Clerk, Supabase, Cognito and the like) issues the
tokens, and `@haikit/auth` checks them against its JWKS.

Exported by `@haikit/auth`: `createAuth`, `Auth`, `AuthOptions`,
`JwtOptions`, `CookieOptions`, `AuthUser`, `AuthStore`, `memoryAuthStore`. By
`@haikit/auth/postgres`: `pgAuthStore`, `Queryable`, `migrate`, `schema`.

Checked against `@haikit/*` 0.28.0. Source: `packages/auth/src/index.ts`,
`packages/auth/src/memory.ts` and `packages/auth/src/postgres.ts`.

- [`createAuth`](#createauth): `AuthOptions`, `JwtOptions`, `CookieOptions`
- [`Auth`](#auth): `gate`, `handler`, `signIn`, `signOut`, `verify`, `user`,
  `ownerOf`, `claim`, `revoke`, and `AuthUser`
- [Tokens](#tokens): what one carries, where it's read from, renewal,
  revocation
- [The gate](#the-gate): what it admits and refuses
- [Routes](#routes): `GET /auth/me`, `POST /auth/sign-out`
- [Stores](#stores): `AuthStore`, `memoryAuthStore`, `pgAuthStore`,
  `Queryable`, `migrate`, `schema`
- [Security](#security)

```ts
import { createServer } from "node:http";
import { createHai, nodeHandler } from "@haikit/server";
import { createAuth } from "@haikit/auth";
import { pgAuthStore } from "@haikit/auth/postgres";

const auth = createAuth({ store: pgAuthStore(pool), jwt: { secret: process.env.HAIKIT_AUTH_SECRET } });
const hai = createHai({ /* … */ });
const routes = nodeHandler(hai, "/hai", { gate: auth.gate });
const authRoutes = auth.handler("/auth");

createServer(async (req, res) => {
  if (await routes(req, res)) return;
  if (await authRoutes(req, res)) return;
  if (req.url === "/login" && req.method === "POST") {
    const userId = await checkPassword(req); // the app's own login
    await auth.signIn(res, userId);
    return res.writeHead(303, { location: "/" }).end();
  }
  // …
}).listen(5180);
```

[`examples/hello-auth`](https://github.com/wfoxd/haikit/tree/main/examples/hello-auth) is a whole app built this
way, with a name-only sign-in page, and the third tutorial,
[Who's asking](../tutorial-3.md), builds it step by step.

## `createAuth`

```ts
function createAuth(options: AuthOptions): Auth;

interface AuthOptions {
  store: AuthStore;
  jwt: JwtOptions;
  cookie?: CookieOptions;
  origins?: string[];
}

interface JwtOptions {
  secret?: string | string[];
  jwks?: string | URL;
  issuer?: string;
  audience?: string | string[];
  algorithms?: string[];
  userClaim?: string;
  ttlMs?: number;
  clockToleranceMs?: number;
}

interface CookieOptions {
  name?: string;
  secure?: boolean;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `store` | required | Where ownership and revocations are kept (see [Stores](#stores)) |
| `jwt.secret` | none | Signs the tokens `signIn` issues, with HS256 (the first HS algorithm allowed), and verifies them. Given several, the first signs and every one verifies, so a secret can be rotated out. Each must be at least 32 bytes, as UTF-8 |
| `jwt.jwks` | none | An identity provider's JWKS URL. Its tokens are verified against the keys there, fetched by `jose`'s `createRemoteJWKSet` with its defaults: when first needed, again once 600,000 ms old, and for a key id it doesn't have, at most once every 30,000 ms. A fetch gives up after 5000 ms |
| `jwt.issuer` | none | When set, a token must carry this `iss`, and `signIn`'s tokens do |
| `jwt.audience` | none | When set, a token's `aud` must include this, or one of these, and `signIn`'s tokens carry it |
| `jwt.algorithms` | `["HS256"]` with a secret, plus `["RS256", "ES256", "EdDSA"]` with a JWKS | The algorithms a token may be signed with |
| `jwt.userClaim` | `"sub"` | The claim that names the user. `signIn`'s tokens carry the user in `sub`, and in this claim too when it's another. It can't be one every token sets for itself, such as `iss`, which would name every user the same |
| `jwt.ttlMs` | `604_800_000` (7 days) | How long a token `signIn` issues lasts, rounded down to whole seconds, and its cookie's `Max-Age` |
| `jwt.clockToleranceMs` | `5_000` | How far the issuer's clock and this server's may differ when `exp` and `nbf` are checked. A finite number, at least 0 |
| `cookie.name` | `"__Host-haikit_token"`, or `"haikit_token"` when `secure` is `false` | The cookie the token is set in and read from |
| `cookie.secure` | `true` | `false` sends the cookie without `Secure`, so it works over plain http, as on `http://localhost` in Safari, which keeps no `Secure` cookie there. Never set it for production. It's never inferred from a request, such as from `x-forwarded-proto` |
| `origins` | `[]` | Origins a POST that carries the cookie may come from, besides the request's own host, such as `"https://admin.example.com"` (see [The gate](#the-gate)). Behind a proxy that rewrites `Host`, put the public origin here |

An HS algorithm is only ever checked against the secrets, and any other
algorithm only against the JWKS. So a token signed with HS256 using the
provider's public key as the secret, a classic forgery, is refused.

**Throws** an `Error`, at once, when:

| Condition | Message |
| --- | --- |
| Neither `secret` nor `jwks` | `createAuth: jwt needs a secret, a jwks URL, or both` |
| A secret shorter than 32 bytes | `createAuth: each jwt secret must be at least 32 bytes` |
| `none` in `algorithms`, in any case | `createAuth: "none" is not an algorithm a token may use` |
| An HS algorithm with no secret | `createAuth: <alg> needs jwt.secret` |
| Any other known algorithm with no JWKS | `createAuth: <alg> needs jwt.jwks` |
| An algorithm that's neither: not one of `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512`, `EdDSA`, `Ed25519` | `createAuth: unknown algorithm <alg>` |
| A secret, but no HS algorithm allowed | `createAuth: jwt.secret is given, but jwt.algorithms allows no HS algorithm` |
| A `jwks` that isn't a URL | `createAuth: jwt.jwks must be a URL` |
| A `ttlMs` under 1000, or not finite | `createAuth: jwt.ttlMs must be at least 1000` |
| A `userClaim` that's `iss`, `aud`, `exp`, `nbf`, `iat`, `jti` or `auth_time` | `createAuth: jwt.userClaim can't be "<name>", a claim every token sets for itself` |
| A `clockToleranceMs` that's negative, `NaN` or infinite, which would stop `exp` and `nbf` being checked | `createAuth: jwt.clockToleranceMs must be a finite number, at least 0` |
| A cookie name with a character a cookie name can't have | `createAuth: cookie.name isn't a valid cookie name` |
| A `__Host-` or `__Secure-` name with `secure: false`, which a browser would drop | `createAuth: a __Host- cookie must be secure`, or `__Secure-` |
| An entry in `origins` that isn't a URL | `createAuth: <entry> isn't an origin such as https://app.example.com` |

## `Auth`

```ts
interface Auth {
  readonly gate: Gate;
  handler(basePath?: string): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  signIn(res: ServerResponse, userId: string, claims?: Record<string, unknown>): Promise<string>;
  signOut(res: ServerResponse): void;
  verify(token: string): Promise<AuthUser | null>;
  user(req: IncomingMessage): Promise<AuthUser | null>;
  ownerOf(conversationId: string): Promise<string | null>;
  claim(conversationId: string, userId: string): Promise<void>;
  revoke(userId: string): Promise<void>;
}

interface AuthUser {
  id: string;
  claims: Record<string, unknown>;
}
```

### `gate`

The [gate](http.md#gates) to pass to `nodeHandler(hai, basePath, { gate })`.
See [The gate](#the-gate).

### `handler`

Returns a request handler for `GET {basePath}/me` and
`POST {basePath}/sign-out`, `basePath` defaulting to `"/auth"`. It resolves
`true` when it answered, and `false` for any other method or path, which the
app serves. It never rejects. See [Routes](#routes).

### `signIn`

Once the app's own login has checked the user: issues a token naming
`userId`, with `claims`, sets it as the cookie on `res`, and resolves to the
token. A client that sends it as `Authorization: Bearer <token>` instead,
such as a native app, can keep it. Call it before the response's headers are
sent. A `Set-Cookie` the response already has is kept.

The cookie is `<name>=<token>; Max-Age=<ttlMs in s>; Path=/; HttpOnly;
SameSite=Lax; Secure`, without `Secure` when `cookie.secure` is `false`.

**Rejects** with an `Error` when there's no `jwt.secret`:
`signIn needs jwt.secret: an identity provider's tokens are issued by the
provider`. With a `TypeError` for an empty or non-string `userId`,
`signIn: userId must be a non-empty string`, and for a claim it sets itself
(`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`, `auth_time`, or
`userClaim`):
`signIn: "<name>" is set by signIn, not by claims`.

### `signOut`

Clears the cookie on `res`: `<name>=; Max-Age=0`, with the same attributes.
The token itself stays valid until it expires: a copy of it still works,
unless the user is `revoke`d.

### `verify`

The user a token names, if it is valid (see [Tokens](#tokens)) and not
revoked, with every claim it carries; else `null`. It never throws for a bad
token. A store that fails rejects.

### `user`

`verify` for a request's token: the `Authorization: Bearer` header if there
is one, else the cookie. `null` with neither. For the app's own routes.

### `ownerOf`

Who owns a conversation, or `null` if no one does. A tool learns who it
runs for with `await auth.ownerOf(ctx.conversationId)`. That works in a wake
turn too, which no request carries a token for.

Owners never change, so each one found is kept in memory, the latest
10,000 of them. A conversation with no owner yet is always looked up, since
another server may have just created it.

### `claim`

Makes a conversation `userId`'s, such as one started before sign-in existed,
or by an app that creates conversations itself. Owners never change: a
conversation that already has another owner is refused, with the store's
error, `conversation <id> already belongs to someone else` from both built-in
stores. The same owner again does nothing.

Throws a `TypeError` for an empty or non-string id:
`claim: conversationId must be a non-empty string`, or
`claim: userId must be a non-empty string`.

A conversation made before the gate was in place has no owner, so the gate
answers it as unknown to everyone until it is claimed. Don't hand one to
whoever asks first: a conversation id may have been seen by others (see
[HTTP routes](http.md#security-and-proxies)).

### `revoke`

Refuses every sign-in of `userId`'s before now: "sign out everywhere". It
stores the time in the store, and this server refuses those tokens at once,
a check already reading the store included. Other servers keep each user's
time for up to 30,000 ms, counted from when they asked the store for it,
before reading it again, so they refuse them within that. An events stream
already open ends at its gate's next check, every 60,000 ms (see
[HTTP routes](http.md#gates)): on this server, within 60,000 ms of the
revocation. On another, that check may still use the time it kept from
before, so the stream can stay open up to about 90,000 ms after it: up to
30,000 ms until the server reads the store again, then up to 60,000 ms until
the next check.

A token's sign-in time is its `auth_time` for a token `signIn` issued, which
a renewal keeps (see [Tokens](#tokens)). So a cookie renewed by a server that
hadn't yet read the revocation is refused too, once it has. For a provider's
token it is its `iat`: the provider decides when its user signs in again.

It is by the second: a token is refused when its sign-in time is before the
second `revoke` ran in, and one without one is refused once its user has a
revocation time. So a sign-in in that same second, just before, still
counts, and a sign-in straight after is never refused.

## Tokens

**What `signIn` issues:** a JWT, signed with the first secret and the first
HS algorithm allowed, header `{ alg, typ: "JWT" }`, carrying:

| Claim | Value |
| --- | --- |
| `sub` | The user's id |
| `userClaim` | The user's id again, when `userClaim` isn't `sub` |
| `iat` | Now, in whole seconds |
| `auth_time` | When the user signed in, in whole seconds: `iat`, on a token `signIn` issued; the first token's, on a renewal |
| `exp` | `iat` plus `ttlMs`, in whole seconds |
| `jti` | A random UUID |
| `iss`, `aud` | `jwt.issuer` and `jwt.audience`, when set |
| … | The app's `claims` |

**What's accepted:** a token whose:

- algorithm is in `algorithms`, with its signature checked against the
  secrets for an HS algorithm, or else against the JWKS;
- has an `exp`, since one without would never expire, and it hasn't passed,
  and `nbf` has, give or take `clockToleranceMs`;
- `iss` and `aud` match, when `issuer` and `audience` are set;
- `userClaim` is a non-empty string;
- sign-in time (`auth_time` on a token `signIn` issued, `iat` on a
  provider's) isn't before its user's revocation time, if they have one.

Anything else is refused. The reason isn't sent to the browser. A JWKS that
can't be fetched or read refuses every token that needs it, and is logged
with `console.error` as `[haikit] auth: the JWKS couldn't be read:`. A token
at fault is never logged.

**Where it's read from:** the `Authorization: Bearer <token>` header if the
request has one, else the cookie. A Bearer header is used even when its
token is refused: the cookie isn't tried.

**Renewal.** Nothing renews a token by itself. `GET /auth/me` issues the
cookie again, with the same claims and sign-in time (`auth_time`) and a new
`iat`, `exp` and `jti`, once a
token `signIn` issued, sent as the cookie, is past half its life, and not
before. So a cookie is renewed only by a visit between half of `ttlMs` and
`ttlMs` after it was issued: a page that asks `/auth/me` as it opens stays
signed in while it's opened at least once every half of `ttlMs` (3.5 days by
default). Opened less often, a visit can fall before the midpoint, renewing
nothing, and the next after the end. A provider's tokens are renewed by the provider.
A client that sends them as Bearer tokens should fetch a fresh one for each
request (see [`createChat`'s `fetch`](client.md#createchat)): an events
stream ends when its token stops being accepted, `clockToleranceMs` after its
`exp`, and its reconnect then takes the new one.

## The gate

`gate.admit`, for each request (see [HTTP routes](http.md#gates)):

1. **The token.** None: **401** `sign in to continue`. One that isn't
   accepted (see [Tokens](#tokens)): **401**
   `your sign-in has expired or is invalid`.
2. **On a POST, the content type.** A body sent as anything but
   `application/json` (parameters such as `; charset=utf-8` allowed): **415**
   `the request body must be sent as application/json`. A form on another
   site can't send JSON without asking first, with a preflight `OPTIONS`
   request, and `nodeHandler` answers none.
3. **On a POST that carries the cookie, where it came from.** Refused with
   **403** `this request came from another site` when:
   - its `Origin` header is present and is neither listed in `origins` nor
     names the request's own `Host`. A page can't forge either header.
     `x-forwarded-host` isn't trusted, since a page's script can set it where
     the app's CORS lets it: behind a proxy that rewrites `Host`, list the
     public origin in `origins`;
   - its `Origin` is `null`, as from a sandboxed frame or a file;
   - it has no `Origin`, and a `sec-fetch-site` other than `same-origin` or
     `none`.

   A request with no `Origin` and no `sec-fetch-site`, as a client that isn't
   a browser sends, passes. A Bearer token is never sent by a browser on its
   own, so a request carrying one skips this check, and may come from
   another origin, where the app's own CORS allows it.
4. **Admitted,** as the user's id, until the token stops being accepted:
   its `exp` plus `clockToleranceMs`, in epoch ms.

`gate.allows(principal, id)` is whether `ownerOf(id)` is `principal`.
`gate.created(principal, id)` is `claim(id, principal)`.

## Routes

`auth.handler(basePath = "/auth")` answers two routes:

**`GET {basePath}/me`:** **200** with `{ "user": { "id", "claims" } }` for
the request's user (see [`user`](#user)), or `{ "user": null }`, and
`cache-control: no-store`. Past half its life, a cookie token is issued
again, with the response (see [Tokens](#tokens)). A store that fails is
answered **500** with `{ "error": "<message>" }`, and logged as
`[haikit] auth request failed:`.

**`POST {basePath}/sign-out`:** clears the cookie, as `signOut` does, and
answers **204** with `cache-control: no-store`. From another site (the
`Origin` check of [The gate](#the-gate), step 3), it's **403** with
`{ "error": "this request came from another site" }`, and the cookie stays.
The body isn't read.

## Stores

### `AuthStore`

```ts
interface AuthStore {
  getOwner(conversationId: string): Promise<string | null>;
  setOwner(conversationId: string, userId: string): Promise<void>;
  getNotBefore(userId: string): Promise<number | null>;
  setNotBefore(userId: string, at: number): Promise<void>;
}
```

Tokens are stateless, so a store keeps only two things:

| Method | Must |
| --- | --- |
| `getOwner` | Return the owner `setOwner` recorded, or `null` |
| `setOwner` | Record the owner. The same owner again does nothing. Another owner is refused, by rejecting, and the first stays. With several servers, that check and the write are one atomic step, so two claims at once can't both win |
| `getNotBefore` | Return the latest time `setNotBefore` recorded for the user, in epoch ms to the millisecond, or `null` |
| `setNotBefore` | Record the time, unless the user already has a later one |

### `memoryAuthStore`

```ts
function memoryAuthStore(): AuthStore;
```

Keeps both in this process's memory. They're gone when it stops, and no other
process sees them: for one server, and for development. A conversation in a
`memoryStore` is gone on a restart too.

### `pgAuthStore`

```ts
// from "@haikit/auth/postgres"
function pgAuthStore(db: Queryable): AuthStore;

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
```

Keeps both in Postgres, shared by every server. Each method is one
statement. `setOwner` is an `INSERT … ON CONFLICT DO UPDATE` that leaves the
row as it was and returns its owner, so of two claims at once, one wins and
the other is refused. `Queryable` is the same shape as `@haikit/postgres`'s
(see [Stores](stores.md#queryable)), so one pool serves both.

### `migrate`, `schema`

```ts
function migrate(db: Queryable): Promise<void>;
const schema: readonly string[];
```

`migrate` runs each statement of `schema`, in order. Each is idempotent, so
it can run on every start. Pass `schema` to your own migration tool instead
if you have one.

```sql
CREATE TABLE IF NOT EXISTS haikit_auth_owners (
  conversation_id text PRIMARY KEY,
  user_id         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS haikit_auth_owners_user ON haikit_auth_owners (user_id);
CREATE TABLE IF NOT EXISTS haikit_auth_revocations (
  user_id    text PRIMARY KEY,
  not_before timestamptz NOT NULL
);
```

Nothing deletes an owner. A conversation swept from the conversation store
leaves its row, which no request can reach: its id was the conversation's.

## Security

- **Same site, or Bearer tokens.** The cookie is `SameSite=Lax`, which a
  browser applies per site, not per origin. A page on another site never
  sends it with a request to the routes, so a page there needs Bearer
  tokens. A page on another origin of the same site, such as
  `https://app.example.com` calling `https://api.example.com`, can send the
  cookie, with `credentials: "include"`, wherever the app's own CORS allows
  credentials from it and its origin is in `origins`. Either way, the CORS
  is the app's: `nodeHandler` answers no `OPTIONS` preflight.
- **Signals still reach everyone.** A gate keeps each user to their own
  conversations, but a signal goes to every events stream, every signed-in
  user's (see [Signals](signals.md)). Never put one user's data in a signal.
- **Signing out isn't revoking.** `signOut` clears one browser's cookie. To
  end every session, as after a password change, call `revoke`.
- **Keep the secret secret,** and at least 32 random bytes. To rotate it,
  put the new one first and keep the old one after it until the old one's
  tokens have expired, `ttlMs` later.

## Limits

| What | Value |
| --- | --- |
| Shortest secret | 32 bytes |
| Default token life, and cookie `Max-Age` | 604,800,000 (7 days) |
| Shortest `ttlMs` | 1000 |
| Default clock tolerance | 5000 |
| How long a server keeps a user's revocation time before reading it again | 30,000 |
| Owners and revocation times kept in memory, each | 10,000 most recent |
| When `/auth/me` renews a cookie token | past half its life, not before |
| How often a page must ask `/auth/me` to stay signed in | at least once every half of `ttlMs`: 3.5 days by default |
| Longest an open events stream outlives a revocation | 60,000 on the server that revoked; about 90,000 on another |
| Revocation granularity | 1 s: a sign-in in the second `revoke` ran in still counts |
| JWKS: refetched once older than / for an unknown key id at most every / fetch timeout | 600,000 / 30,000 / 5000 (`jose`'s defaults) |
