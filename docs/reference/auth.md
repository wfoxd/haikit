# Sign-in and ownership

`@haikit/auth` says who is asking, from a verified JWT, and lets each user
use only the conversations they started. It makes a [gate](http.md#gates)
for `nodeHandler`, so every route checks the user's token, and a
conversation that isn't theirs is answered as one that doesn't exist. It
doesn't replace the app's own login. Either the app checks the user its own
way and calls `signIn`, which issues a token as a cookie, or the app's
identity provider (Auth0, Clerk, Supabase, Cognito and the like) issues the
tokens, and `@haikit/auth` checks them against its JWKS. Or the user signs in
with Google, or another OpenID Connect provider, through `@haikit/auth/oidc`,
or with GitHub, or another OAuth 2.0 provider, through `@haikit/auth/oauth2`,
which end in the same `signIn`.

Exported by `@haikit/auth`: `createAuth`, `Auth`, `AuthOptions`,
`JwtOptions`, `CookieOptions`, `AuthUser`, `AuthStore`, `SignInProvider`,
`memoryAuthStore`. By `@haikit/auth/postgres`: `pgAuthStore`, `Queryable`,
`migrate`, `schema`. By `@haikit/auth/oidc`: `oidc`, `google`,
`OidcOptions`, `GoogleOptions`, `OidcProfile`, `SignInAs`. By
`@haikit/auth/oauth2`: `oauth2`, `github`, `OAuth2Options`, `GitHubOptions`,
`OAuth2Profile`, `ProviderApi`, `SignInAs`.

Checked against `@haikit/*` 0.30.0 and `oauth4webapi` 3.8.8. Source:
`packages/auth/src/index.ts`, `packages/auth/src/memory.ts`,
`packages/auth/src/postgres.ts`, `packages/auth/src/oidc.ts`,
`packages/auth/src/oauth2.ts` and `packages/auth/src/provider.ts`.

- [`createAuth`](#createauth): `AuthOptions`, `JwtOptions`, `CookieOptions`
- [`Auth`](#auth): `gate`, `handler`, `signIn`, `signOut`, `verify`, `user`,
  `ownerOf`, `claim`, `revoke`, and `AuthUser`
- [Tokens](#tokens): what one carries, where it's read from, renewal,
  revocation
- [The gate](#the-gate): what it admits and refuses
- [Routes](#routes): `GET /auth/me`, `POST /auth/sign-out`, and a
  provider's two
- [Signing in with a provider](#signing-in-with-a-provider):
  `SignInProvider`, the flow cookie, `sign_in_error`, `oidc`, `google`,
  `OidcOptions`, `GoogleOptions`, `OidcProfile`, `SignInAs`, `oauth2`,
  `ProviderApi`, `github`, `OAuth2Options`, `GitHubOptions`, `OAuth2Profile`
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
  providers?: SignInProvider[];
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
| `providers` | `[]` | Where else a user can sign in, such as [`google()`](#google) or [`github()`](#github). `handler` answers two routes for each (see [Signing in with a provider](#signing-in-with-a-provider)). Needs `jwt.secret` |

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
| `providers` with no `jwt.secret` | `createAuth: providers need jwt.secret: a sign-in through one ends in signIn` |
| A provider `name` that isn't 1 to 32 lowercase letters, digits or dashes starting with a letter, or is `me` or `sign-out` | `createAuth: "<name>" can't name a provider: 1 to 32 lowercase letters, digits or dashes, starting with a letter, and not me or sign-out` |
| Two providers of one `name` | `createAuth: two providers are named "<name>"` |
| A provider `redirectUri` that isn't a URL | `createAuth: provider "<name>"'s redirectUri isn't a URL` |
| Two providers whose `redirectUri` has the same path | `createAuth: providers "<first>" and "<second>" both come back to <path>` |
| A `cookie.name` that starts as a flow cookie's does, `__Host-haikit_sign_in-` (or `haikit_sign_in-` when not `secure`), with `providers` | `createAuth: cookie.name can't start with <prefix>: sign-ins through a provider keep their cookies under those names` |
| A provider `failureUrl` that isn't a path on this site (see [Signing in, there and back](#signing-in-there-and-back)) | `createAuth: provider "<name>"'s failureUrl must be a path on this site, such as /sign-in` |

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
`POST {basePath}/sign-out`, and for each of the `providers`,
`GET {basePath}/{name}` and `GET` the path of its `redirectUri`, whatever
`basePath` is. `basePath` defaults to `"/auth"`. It resolves `true` when it
answered, and `false` for any other method or path, which the app serves.
It never rejects. See [Routes](#routes).

**Throws** an `Error`, at once, when a provider's `redirectUri` comes back
to a route the handler answers already, `{basePath}/me`,
`{basePath}/sign-out` or `{basePath}/{name}` of any provider, which it would
take over: `auth.handler: provider "<name>"'s redirectUri comes back to
<path>, a route the handler answers already`.

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

**`GET {basePath}/{name}`** and **`GET` the path of a provider's
`redirectUri`:** a sign-in through that provider, there and back. See
[Signing in with a provider](#signing-in-with-a-provider).

## Signing in with a provider

```ts
import { createAuth } from "@haikit/auth";
import { google } from "@haikit/auth/oidc";

const auth = createAuth({
  store,
  jwt: { secret: process.env.HAIKIT_AUTH_SECRET },
  providers: [
    google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: "https://app.example.com/auth/google/callback",
      failureUrl: "/sign-in",
    }),
  ],
});
// auth.handler("/auth") now also answers GET /auth/google and GET /auth/google/callback
```

A link to `/auth/google` sends the browser to Google. Google sends it back
to `redirectUri`, and the user its answer names is signed in with
[`signIn`](#signin). From then on it's as if the app's own login had signed
them in: the same cookie, the same gate, `/auth/me`'s renewal and `revoke`.
[`examples/hello-auth`](https://github.com/wfoxd/haikit/tree/main/examples/hello-auth)
does this when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, and
step 10 of [Who's asking](../tutorial-3.md) builds it.

[`github()`](#github), from `@haikit/auth/oauth2`, is the same for GitHub,
at `/auth/github`. A provider that speaks OpenID Connect goes through
[`oidc`](#oidc), and one that speaks only OAuth 2.0 through
[`oauth2`](#oauth2).

### `SignInProvider`

```ts
interface SignInProvider {
  readonly name: string;
  readonly redirectUri: string;
  readonly failureUrl: string;
  start(): Promise<{ url: URL; flow: Record<string, string> }>;
  finish(
    callback: URL,
    flow: Record<string, string>,
  ): Promise<{ userId: string; claims?: Record<string, unknown> } | { error: "access_denied" | "refused" | "expired" }>;
}
```

What [`oidc`](#oidc), [`google`](#google), [`oauth2`](#oauth2) and
[`github`](#github) return, and what an app writes for a provider none of
them fits.

| Member | Meaning |
| --- | --- |
| `name` | The route segment, `{basePath}/{name}`: 1 to 32 lowercase letters, digits or dashes, starting with a letter, and not `me` or `sign-out` |
| `redirectUri` | Where the provider sends the browser back, exactly as registered with it. Its path is the callback route, whatever `basePath` is |
| `failureUrl` | A path on this site that a failed sign-in is sent to (see [When it fails](#when-it-fails)) |
| `start()` | Where to send the browser, and the strings `finish` will need, which the [flow cookie](#the-flow-cookie) keeps meanwhile |
| `finish(callback, flow)` | The URL the browser came back to, and what `start` kept: the user who signed in, with the claims for their token, or why no one did. Throws for anything else |

### Signing in, there and back

1. **`GET {basePath}/{name}`**, such as `/auth/google?return_to=/chats`:
   - `return_to` is kept if it's a path on this site: it starts with one
     `/`, not two, and has no `\` and no control character. A browser reads
     `\` as `/` and drops a tab, so either could make a path into another
     site. Then whatever isn't printable ASCII, and `"`, is percent-encoded,
     so a `Location` header can carry it, and the result must be at most
     512 characters. Escapes already there are kept as they are. Anything
     else, or none, is `/`.
   - `start()` is called. The answer is **303** to the URL it returned, with
     `cache-control: no-store`, and a flow cookie holding the provider's
     name, its flow and `return_to`.
   - The flow cookie is one of three (see [The flow cookie](#the-flow-cookie)):
     the first the request didn't carry, or, when it carried all three, the
     one whose sign-in started earliest, by its `exp`. That sign-in's way back
     is then `expired`. A browser that overwrites a cookie keeps its place
     in the order it sends them (RFC 6265, 5.3), so that order can't say.
   - A flow cookie whose name and value come to more than 1,365 bytes, a
     third of the 4,096 a browser keeps for one cookie, would let the three
     together pass it. Sealed again with `return_to` as `/`, it's set if it
     then fits. If it still doesn't, it's **303** to `failureUrl` with
     `sign_in_error=failed`, and logged as
     `[haikit] auth: a sign-in with <name> couldn't start: its flow is too large for a cookie`.
   - If `start()` throws, as when the provider's settings can't be read: a
     **303** to `failureUrl` with `sign_in_error=failed`, and no cookie. It's
     logged as `[haikit] auth: a sign-in with <name> couldn't start:`.
2. **`GET` the path of `redirectUri`**, where the provider sends the browser
   back:
   - The browser's flow cookies are tried in turn. One that doesn't open (sealed with no secret of this server's, altered, or past
     its 10 minutes), or is another provider's, is passed over and left as
     it is.
   - For each of this provider's, `finish(url, flow)`:
     - **`{ error: "expired" }`,** the answer to another sign-in than this
       flow's: the next is tried, and this one's cookie is kept, for its own
       way back.
     - **A user:** its cookie is cleared, `signIn(res, userId, claims ?? {})`,
       then **303** to `return_to`. A claim named as `jwt.userClaim` is left
       out of `claims` first: that claim holds the user id, as when
       `/auth/me` renews a token. So with `userClaim: "email"`, the token's
       `email` is the user id, and not the provider's.
     - **Another `{ error }`:** its cookie is cleared, and that code.
     - **A throw,** `signIn`'s included, as for a claim it sets itself: its
       cookie is cleared, and `failed`, logged as
       `[haikit] auth: a sign-in with <name> failed:`.
   - None left, or none at all: `expired`, and no cookie is cleared.

   Only the cookie of the sign-in that ends is ever cleared, so a sign-in
   started in another tab meanwhile, even while this one's code is being
   exchanged, still finishes: unless it was a fourth, and took this one's
   cookie (see [The flow cookie](#the-flow-cookie)).

Both routes answer GET only; another method resolves `false`. A request that
throws outside these steps is answered **500**, as `/auth/me` is.

### The flow cookie

What a sign-in needs to finish travels with the browser, so any of several
servers can finish what another started:

- **Name:** `__Host-haikit_sign_in-0`, `-1` or `-2`, or `haikit_sign_in-0`,
  `-1` or `-2` when `cookie.secure` is `false`: one for each sign-in on its
  way, and three at most. It isn't configurable.
- **Attributes:** `<name>=<sealed>; Max-Age=600; Path=/; HttpOnly;
  SameSite=Lax; Secure`, without `Secure` when `cookie.secure` is `false`.
  Cleared with `Max-Age=0`.
- **Sealed:** a JWE (`dir`, `A256GCM`) with an `exp` 10 minutes on, and the
  payload `{ p: name, f: flow, r: return_to }`. The browser can neither read
  it nor change it.
- **Key:** HKDF-SHA256 of each `jwt.secret`, with an empty salt, the info
  `haikit/auth sign-in flow`, and 32 bytes. The first secret seals, and every
  one opens, so a rotation doesn't end a sign-in on its way. Because the key
  is derived and not the secret itself, a flow cookie can never pass for a
  token, nor a token for a flow cookie.

`SameSite=Lax` cookies go with a top-level GET from another site, which is
how a provider sends the browser back. A provider that sent it back by POST
(`response_mode=form_post`) would arrive without it. `oidc()` asks for the
default, `query`.

**Several sign-ins at once.** Each tab's sign-in has its own cookie, and
each way back finds and clears only its own, so up to three finish in any
order. A fourth takes the earliest one's cookie. Should the earliest come
back just then, while its code is being exchanged, its answer clears the
cookie it read, which by then holds the fourth's flow, and the fourth's way
back is `expired` too. A server can only clear a cookie by name, never only
if it still holds what it read, so no fixed set of names can rule this out.
It takes four sign-ins at once in one browser, and that timing, and costs a
retry. Two started at the same
moment, before either's cookie is set, see the same free one, and the later
answer's flow is the one kept: the other's way back is `expired`. However
many race, a browser holds at most three flow cookies of at most 1,365 bytes
each, so they never come to more than 4,096 bytes together, and can't push
its requests past a server's header limit.

### When it fails

A sign-in that fails is answered **303** to the provider's `failureUrl`,
with `sign_in_error` added to its query. Its path is sent as configured,
percent-encoded where it isn't printable ASCII, and never normalized:
`/a/..//b` would otherwise become `//b`, which a browser reads as another
host. Nobody is signed in, and the browser is never told more than the
code:

| `sign_in_error` | When |
| --- | --- |
| `access_denied` | The user said no at the provider |
| `refused` | The app's `user` returned `null`, or `google`'s `hostedDomain` didn't match. A custom provider's `{ error }` that isn't one of the three is `refused` too |
| `expired` | No flow cookie of this provider's that this is the answer to: none, one that doesn't open or is past its 10 minutes, one a later sign-in has taken (a fourth at once, or one started at the same moment), or one already ended, as when the way back is opened again |
| `failed` | Anything else: the provider's settings or its token endpoint unreachable, an ID token that doesn't check out, `oauth2`'s `profile` throwing or returning no `sub`, `user` or `signIn` throwing. Logged, with the reason |

### `oidc`

```ts
function oidc(options: OidcOptions): SignInProvider;

interface OidcOptions {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  params?: Record<string, string>;
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
  maxAgeMs?: number;
  user?(profile: OidcProfile): SignInAs | null | Promise<SignInAs | null>;
  failureUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface OidcProfile {
  provider: string;
  sub: string;
  claims: Record<string, unknown>;
}

type SignInAs = string | { userId: string; claims?: Record<string, unknown> };
```

From `@haikit/auth/oidc`. Signs in with any OpenID Connect provider through
the authorization code flow, with PKCE, `state` and `nonce`, on
[`oauth4webapi`](https://github.com/panva/oauth4webapi).

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | The route segment, and the default user id's prefix |
| `issuer` | required | The provider's issuer, an https URL. Its settings are read from `{issuer}/.well-known/openid-configuration`, and its `issuer` there must be this one |
| `clientId`, `clientSecret` | required | The app's client, as registered with the provider |
| `redirectUri` | required | Where the provider sends the browser back, exactly as registered: https, or http on `localhost`, `127.0.0.1` or `[::1]`, and no `#fragment`. It's never worked out from the request, whose `Host` header can say anything |
| `scopes` | `["openid", "email", "profile"]` | What to ask for. `openid` is always asked for |
| `params` | none | More parameters for the provider's sign-in page, such as `{ prompt: "consent" }` |
| `tokenEndpointAuthMethod` | `"client_secret_basic"`, unless the provider's settings list `"client_secret_post"` and not it | How the client proves itself when it exchanges the code, as registered with the provider. A provider's settings say what it supports, not what the client was registered for. In a Basic header, the id and secret are form-encoded, as RFC 6749 says; a provider that refuses a client it knows with `invalid_client` may not decode them, as Google's doesn't, and `"client_secret_post"` is the way round it |
| `maxAgeMs` | none: no limit | How long ago the user may have last signed in at the provider. Sent as `max_age`, in whole seconds (rounded down), and an ID token whose `auth_time` is older than that, or missing, is refused |
| `user` | `{name}:{sub}`, with the default claims | Whom the user signs in as. A string: that user id, with the default claims. An object: that user id, and exactly those claims. `null`: refused |
| `failureUrl` | `"/"` | A path on this site a failed sign-in is sent to |
| `fetch` | the global `fetch` | Reads the provider's settings and exchanges the code: for a proxy, or a test's stand-in provider |

**The default claims** are the ID token's `name`, when it's a string, and
its `email`, only when `email_verified` is `true`. Anyone can type an
address into a provider's sign-up form, so an email the provider hasn't
verified says nothing about who the user is. `sub` is the provider's id for
the user, which it never reuses, and keeps when their email changes. That's
why it, and not the email, is the default user id. With `jwt.userClaim`
set to `email` or `name`, that claim holds the user id instead (see
[Signing in, there and back](#signing-in-there-and-back)): to sign users in
by their email, return it from `user`.

**`start()`:**

1. Read the provider's settings, on the first sign-in. They're kept for the
   process's life. A read that fails is tried again on the next sign-in. An
   `authorization_endpoint` that isn't https, where the user would type
   their password, is thrown: `oidc: <issuer>'s authorization_endpoint isn't https`.
   oauth4webapi refuses to send a request to a `token_endpoint` that isn't
   https.
2. Make a `state`, a `nonce` and a PKCE code verifier, each 32 random bytes
   as base64url, and the verifier's `S256` challenge.
3. Send the browser to the provider's `authorization_endpoint` with `params`,
   then `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`,
   `nonce`, `code_challenge`, `code_challenge_method=S256`, and `max_age`
   with `maxAgeMs`.
4. Keep `{ state, nonce, verifier }` in the flow.

**`finish()`:**

1. A `state` on the way back that isn't the flow's: `expired`.
2. An `error=access_denied`: `access_denied`. Any other error, or a response
   that doesn't check out: thrown, so `failed`.
3. Exchange the code at the `token_endpoint`, with the verifier and
   `redirect_uri`. The client authenticates as `tokenEndpointAuthMethod`
   says.
4. Check the ID token, which must be there:
   - its `iss` is the issuer;
   - its `aud` includes `clientId`, and if it names several, its `azp` is
     `clientId`;
   - it hasn't expired;
   - its `nonce` is the flow's;
   - with `maxAgeMs`, it has an `auth_time` no older than `max_age`;
   - its `alg` is one the provider's settings list.

   Its signature isn't checked. It came straight from the token endpoint,
   over https, to this server, which OpenID Connect Core 1.0 §3.1.3.7 allows
   to stand in for the signature.
5. Call `user({ provider: name, sub, claims })`, with the ID token's claims.

Reading the settings and exchanging the code each give up after 10,000 ms.

**Throws** an `Error`, at once, when:

| Condition | Message |
| --- | --- |
| A `name` that isn't 1 to 32 lowercase letters, digits or dashes, starting with a letter | `oidc: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter` |
| An `issuer` that isn't a URL | `oidc: issuer must be a URL, such as https://accounts.google.com` |
| An `issuer` that isn't https | `oidc: issuer must be an https URL` |
| An empty `clientId` | `oidc: clientId must be a non-empty string` |
| An empty `clientSecret` | `oidc: clientSecret must be a non-empty string` |
| A `redirectUri` that isn't a URL | `oidc: redirectUri must be a URL, such as https://app.example.com/auth/google/callback` |
| A `redirectUri` that's http anywhere but on `localhost`, `127.0.0.1` or `[::1]`, any other scheme, or one with a `#fragment` | `oidc: redirectUri must be https, or http on localhost, with no #fragment` |
| `params` that set `client_id`, `redirect_uri`, `response_type`, `response_mode`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method` or `max_age` (which `maxAgeMs` sets, and checks) | `oidc: params can't set <param>: the sign-in sets it` |
| A `tokenEndpointAuthMethod` that's neither | `oidc: tokenEndpointAuthMethod must be client_secret_basic or client_secret_post` |
| A `maxAgeMs` that's negative, `NaN` or infinite | `oidc: maxAgeMs must be a finite number, at least 0` |

A bad `failureUrl` is refused by `createAuth`, which uses it.

### `google`

```ts
function google(options: GoogleOptions): SignInProvider;

interface GoogleOptions extends Omit<OidcOptions, "name" | "issuer"> {
  hostedDomain?: string;
  prompt?: string;
  tokenEndpointAuthMethod?: OidcOptions["tokenEndpointAuthMethod"];
}
```

From `@haikit/auth/oidc`. `oidc` with the `name` `"google"` and the issuer
`https://accounts.google.com`. A Google user's default id is `google:`
followed by Google's `sub`, a string of digits.

| Option | Default | Meaning |
| --- | --- | --- |
| `hostedDomain` | none | A Google Workspace domain, such as `"example.com"`. It's sent as `hd`, so Google's page offers that domain's accounts first. An ID token whose `hd` claim isn't this domain is `refused`, before `user` is called. The `hd` parameter alone is only a hint to Google's page |
| `prompt` | `"select_account"` | Google's `prompt`, so a user with several accounts picks one. `""` sends none |
| `tokenEndpointAuthMethod` | `"client_secret_post"` | Google's token endpoint doesn't decode the form-encoding of a Basic header's id and secret, and answers a client id sent that way, with its dots and dashes encoded, `invalid_client`: *The OAuth client was not found.* In the body, it reads them |

Every other option is `oidc`'s. `prompt` and `hd` are added to `params`,
which can't set either: they're these options'.

**Throws:**

| Condition | Message |
| --- | --- |
| An empty `hostedDomain` | `google: hostedDomain must be a domain, such as example.com` |
| `params` that set `prompt` | `google: params can't set prompt: use the prompt option` |
| `params` that set `hd`: alone, it would only be a hint to Google's page, never checked | `google: params can't set hd: use hostedDomain, which also checks the account's domain` |

Otherwise, what `oidc` throws.

To register the client: in the Google Cloud console, create an OAuth client
ID of type **Web application**, and add `redirectUri` to its
**Authorized redirect URIs**. Google allows `http://localhost` there, for
development.

### `oauth2`

```ts
function oauth2(options: OAuth2Options): SignInProvider;

interface OAuth2Options {
  name: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  params?: Record<string, string>;
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
  profile(api: ProviderApi): Promise<{ sub: string; claims?: Record<string, unknown> }>;
  user?(profile: OAuth2Profile): SignInAs | null | Promise<SignInAs | null>;
  failureUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface OAuth2Profile {
  provider: string;
  sub: string;
  claims: Record<string, unknown>;
}
```

From `@haikit/auth/oauth2`, which exports `SignInAs` too, the same type as
`@haikit/auth/oidc`'s. Signs in with an OAuth 2.0 provider that doesn't
speak OpenID Connect, such as GitHub, Discord or Spotify, through the
authorization code flow, with PKCE and `state`, on
[`oauth4webapi`](https://github.com/panva/oauth4webapi). There's no ID token
to say who signed in, so the code is exchanged for an access token,
`profile` reads the user from the provider's API with it, and the token is
dropped: nothing keeps it, and `user` never sees it.

`OAuth2Profile` has the shape of `OidcProfile`, so one `user` function can
serve providers of both kinds.

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | The route segment, and the default user id's prefix |
| `authorizationEndpoint` | required | Where the user signs in, an https URL, such as `https://github.com/login/oauth/authorize`. A query it carries is kept |
| `tokenEndpoint` | required | Where the code is exchanged for an access token, an https URL |
| `clientId`, `clientSecret` | required | The app's client, as registered with the provider |
| `redirectUri` | required | Where the provider sends the browser back, exactly as registered: https, or http on `localhost`, `127.0.0.1` or `[::1]`, and no `#fragment`. It's never worked out from the request, whose `Host` header can say anything |
| `scopes` | `[]`: no `scope` is sent | What to ask for. Each is sent once, separated by spaces |
| `params` | none | More parameters for the provider's sign-in page, such as `{ allow_signup: "false" }` |
| `tokenEndpointAuthMethod` | `"client_secret_basic"` | How the client proves itself when it exchanges the code, as registered with the provider. There are no settings to read, so nothing else decides it |
| `profile` | required | Who signed in, read from the provider's API with [`api.get`](#providerapi). Its `sub` is the provider's id for the user, which it never reuses, as a non-empty string: `String(user.id)` for a numeric id. Its `claims` are what `user` sees. Put an `email` there with `email_verified: true` only once the provider has verified the address |
| `user` | `{name}:{sub}`, with the default claims | Whom the user signs in as. A string: that user id, with the default claims. An object: that user id, and exactly those claims. `null`: refused |
| `failureUrl` | `"/"` | A path on this site a failed sign-in is sent to |
| `fetch` | the global `fetch` | Exchanges the code, and makes `api.get`'s requests: for a proxy, or a test's stand-in provider |

**The default claims** are, as `oidc`'s, the profile's `name`, when it's a
string, and its `email`, only when `email_verified` is `true`. Nothing else
`profile` returns goes into the token, unless `user` puts it there.

**`start()`** reads nothing from the provider:

1. Make a `state` and a PKCE code verifier, each 32 random bytes as
   base64url, and the verifier's `S256` challenge. No `nonce`: with no ID
   token, nothing would bring it back.
2. Send the browser to `authorizationEndpoint` with `params`, then
   `client_id`, `redirect_uri`, `response_type=code`, `scope` when there are
   scopes, `state`, `code_challenge` and `code_challenge_method=S256`. A
   provider that doesn't know PKCE ignores the challenge, and later the
   verifier, as RFC 6749 §3.1 and §3.2 have it do with a parameter it doesn't
   know.
3. Keep `{ state, verifier }` in the flow.

**`finish()`:**

1. A `state` on the way back that isn't the flow's: `expired`.
2. An `iss` on the way back (RFC 9207) is set aside, unchecked: there's no
   issuer to check it against. Each provider comes back to a path of its own,
   which `createAuth` makes sure of, and finishes only its own flows there:
   RFC 9700 §4.4.2 counts that as the defence against mix-up that `iss` is.
3. An `error=access_denied`: `access_denied`. Any other error, or a response
   that doesn't check out: thrown, so `failed`.
4. Exchange the code at `tokenEndpoint`, with the verifier and
   `redirect_uri`. The client authenticates as `tokenEndpointAuthMethod`
   says. The answer must be a `200` whose JSON has an `access_token` and a
   `token_type`. Anything else is thrown, including a `200` that carries an
   `error` instead, as GitHub's does. An ID token in the answer is checked,
   against an issuer of `authorizationEndpoint`'s origin, which a provider's
   ID tokens seldom name: a provider that issues them speaks OpenID Connect,
   and `oidc` is the one for it.
5. Call `profile(api)`, with an [`api`](#providerapi) for the access token.
   It must return an object whose `sub` is a non-empty string, and whose
   `claims`, if it has them, are an object. Anything else is thrown:
   `oauth2: profile must return { sub, claims? }: sub a non-empty string, such as String(user.id), and claims an object`.
   What `profile` throws is thrown on.
6. Call `user({ provider: name, sub, claims })`, with a copy of the claims,
   or none.

Exchanging the code gives up after 10,000 ms, and so does each `api.get`.

**Throws** an `Error`, at once, when:

| Condition | Message |
| --- | --- |
| A `name` that isn't 1 to 32 lowercase letters, digits or dashes, starting with a letter | `oauth2: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter` |
| An `authorizationEndpoint` that isn't a URL | `oauth2: authorizationEndpoint must be a URL, such as https://github.com/login/oauth/authorize` |
| An `authorizationEndpoint` that isn't https, where the user would type their password | `oauth2: authorizationEndpoint must be an https URL` |
| A `tokenEndpoint` that isn't a URL | `oauth2: tokenEndpoint must be a URL, such as https://github.com/login/oauth/access_token` |
| A `tokenEndpoint` that isn't https, where the client sends its secret | `oauth2: tokenEndpoint must be an https URL` |
| An empty `clientId` | `oauth2: clientId must be a non-empty string` |
| An empty `clientSecret` | `oauth2: clientSecret must be a non-empty string` |
| A `redirectUri` that isn't a URL | `oauth2: redirectUri must be a URL, such as https://app.example.com/auth/github/callback` |
| A `redirectUri` that's http anywhere but on `localhost`, `127.0.0.1` or `[::1]`, any other scheme, or one with a `#fragment` | `oauth2: redirectUri must be https, or http on localhost, with no #fragment` |
| `params` that set `client_id`, `redirect_uri`, `response_type`, `response_mode`, `scope`, `state`, `code_challenge` or `code_challenge_method` | `oauth2: params can't set <param>: the sign-in sets it` |
| A `tokenEndpointAuthMethod` that's neither | `oauth2: tokenEndpointAuthMethod must be client_secret_basic or client_secret_post` |
| A `profile` that isn't a function | `oauth2: profile must be a function: with no ID token, it's what says who signed in` |

A bad `failureUrl` is refused by `createAuth`, which uses it.

```ts
import { oauth2 } from "@haikit/auth/oauth2";

const discord = oauth2({
  name: "discord",
  authorizationEndpoint: "https://discord.com/oauth2/authorize",
  tokenEndpoint: "https://discord.com/api/oauth2/token",
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: "https://app.example.com/auth/discord/callback",
  scopes: ["identify", "email"],
  profile: async (api) => {
    const me = (await api.get("https://discord.com/api/users/@me")) as {
      id: string;
      username: string;
      global_name: string | null;
      email?: string | null;
      verified?: boolean;
    };
    return { sub: me.id, claims: { name: me.global_name ?? me.username, email: me.email, email_verified: me.verified } };
  },
});
// signs in as discord:<id>, with their name, and their email once Discord has verified it
```

### `ProviderApi`

```ts
interface ProviderApi {
  get(url: string, headers?: Record<string, string>): Promise<unknown>;
}
```

From `@haikit/auth/oauth2`. What [`oauth2`](#oauth2)'s `profile` is given: the
provider's API, with the access token the sign-in was given.

**`get(url, headers?)`** sends a GET to `url`, and resolves to the JSON it
answers with:

- `url` must be an https URL, since the access token goes with it. Anything
  else is thrown before a request is made:
  `oauth2: api.get takes an https URL: the access token goes with it`.
- The request carries `authorization: Bearer <access token>`, which
  `headers` can't replace, and `accept: application/json`, unless `headers`
  sets an `accept` of its own. A header's name is matched in any case.
- A redirect isn't followed, so the token goes only where it was sent. It,
  and any other status than 2xx, is thrown as an `Error` with the answer's
  `status`: `oauth2: GET <url> answered <status>`. Catch it in `profile` to
  go on without what it asked for.
- An answer that isn't JSON is thrown, as the `SyntaxError` that parsing it
  throws.
- It gives up after 10,000 ms.

### `github`

```ts
function github(options: GitHubOptions): SignInProvider;

interface GitHubOptions extends Omit<OAuth2Options, "name" | "authorizationEndpoint" | "tokenEndpoint" | "profile"> {
  scopes?: string[];
  tokenEndpointAuthMethod?: OAuth2Options["tokenEndpointAuthMethod"];
}
```

From `@haikit/auth/oauth2`. `oauth2` with the `name` `"github"`, GitHub's
endpoints, `https://github.com/login/oauth/authorize` and
`https://github.com/login/oauth/access_token`, and a `profile` that reads
GitHub's API. A GitHub user's default id is `github:` followed by their
GitHub id, a number, which stays the same when they change their login.

| Option | Default | Meaning |
| --- | --- | --- |
| `scopes` | `["read:user", "user:email"]` | `read:user` reads the profile, and `user:email` the email addresses. Without `user:email`, the user signs in with no email |
| `tokenEndpointAuthMethod` | `"client_secret_post"` | In the body, as GitHub's guide sends the client |

Every other option is `oauth2`'s.

**The profile** asks GitHub's API with `accept: application/vnd.github+json`
and `x-github-api-version: 2022-11-28`:

1. `GET https://api.github.com/user`. Its `id` is the `sub`, as a string.
   An answer with no numeric `id` is thrown:
   `github: GitHub's /user answered with no id`. The claims are everything it
   answers with, except its `email`, which is only the address the user
   chose to show on their profile. Their `name` is their `login` when it's
   `null` or empty, as it often is on GitHub.
2. `GET https://api.github.com/user/emails`. The address marked both
   `primary` and `verified`, if there is one, is the claims' `email`, with
   `email_verified: true`. A 404, as when `user:email` wasn't granted, or a
   403, as for a GitHub App without the *Email addresses* permission, leaves
   the claims with no email, and the user still signs in. Any other failure
   is thrown, so `failed`.

So by default a GitHub user signs in as `github:<id>`, with their name and
their verified primary email in the token, and `user` can read their
`login`, `avatar_url` and the rest from `profile.claims`.

**Throws:** what `oauth2` throws.

To register the client: on GitHub, under **Settings**, **Developer
settings**, **OAuth Apps**, choose **New OAuth App**, and set its
**Authorization callback URL** to `redirectUri`. An OAuth App has one
callback URL, so register another for development, with a callback URL on
`http://localhost`. A GitHub App works too: its user tokens ignore scopes,
and read what its permissions allow.

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
- **A provider's sign-in page is https.** `oidc` refuses to send a browser to
  an `authorization_endpoint` that isn't, whatever the provider's settings
  say, and `oauth2` refuses an `authorizationEndpoint` or a `tokenEndpoint`
  that isn't.
- **A provider's sign-in** carries a one-time `state`, so only the browser
  that started it can finish it; through `oidc`, a `nonce`, so an ID token
  can't be replayed into it; and PKCE, so a code that leaks on the way back
  is no use without the verifier the browser's flow cookie held. Its `redirectUri` is
  configured, never taken from `Host`, and `return_to` is only ever a path
  on this site, so neither can send a user, or their code, elsewhere.
- **Keep a provider's `clientSecret` with the JWT secret,** out of the code.
  With it, anyone can exchange your users' codes.
- **A provider's access token isn't kept.** `oauth2` hands it only to
  `profile`'s `api.get`, which sends it to https URLs only and follows no
  redirect, and drops it once `profile` has said who signed in. It isn't
  stored, isn't in the token `signIn` issues, and isn't passed to `user`.

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
| How long a sign-in through a provider may take, and its flow cookie's `Max-Age` | 600,000 |
| Longest `return_to` kept | 512 characters, percent-encoded |
| Sign-ins a browser may have on their way at once | 3: a fourth takes the earliest's flow cookie |
| Largest flow cookie, name and value | 1,365 bytes, so three come to at most 4,096 |
| `oidc`: reading the provider's settings, and exchanging the code, each give up after | 10,000 |
| `oidc`: the provider's settings are kept | for the process's life, once read |
| `oauth2`: exchanging the code, and each `api.get`, give up after | 10,000 |
