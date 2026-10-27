# @haikit/auth

## 0.30.0

### Minor Changes

- d8b28c9: Sign in with Google, or any OpenID Connect provider. `@haikit/auth/oidc` exports `google()` and `oidc()`, and `createAuth`'s new `providers` option takes what they return. `auth.handler` then answers `GET /auth/<name>`, which sends the browser to the provider, and `GET` the path of its `redirectUri`. On the way back it checks the answer and calls `signIn`, so the user gets the same cookie as one your own login signs in. The code flow carries PKCE, a `state` and a `nonce`, in an encrypted, 10-minute `__Host-haikit_sign_in` cookie. A sign-in that fails goes to the provider's `failureUrl`, with `?sign_in_error=` set to `access_denied`, `refused`, `expired` or `failed`. A user is `google:<sub>` by default, and a `user(profile)` hook can map them to your own id or refuse them. `google({ hostedDomain })` keeps sign-in to one Workspace domain. The new `SignInProvider` type is the contract for a provider of your own.

### Patch Changes

- @haikit/core@0.30.0

## 0.29.0

### Minor Changes

- c00c0bc: New, optional package: `@haikit/auth`. `createAuth({ store, jwt })` says who is asking, from a verified JWT, and makes a `gate` for `nodeHandler` that lets each user use only the conversations they started; another user's is answered as one that doesn't exist. Tokens are either issued by `signIn`, after the app's own login, as an HS256 JWT in a `__Host-haikit_token` cookie (`jwt.secret`, rotatable), or issued by the app's identity provider and checked against its JWKS (`jwt.jwks`, `issuer`, `audience`), sent as the cookie or `Authorization: Bearer`. The gate refuses a POST that isn't JSON (415), and one carrying the cookie from another site (403). `auth.handler()` serves `GET /auth/me`, which renews a cookie past half its life, and `POST /auth/sign-out`. A tool learns its user with `auth.ownerOf(ctx.conversationId)`, in a wake turn too. `revoke(userId)` refuses every sign-in before it: a token `signIn` issued carries its sign-in time as `auth_time`, which a renewal keeps, so a renewal can't outlive a revocation. `clockToleranceMs` must be a finite number, at least 0, `userClaim` can't be a claim every token sets for itself, such as `iss`, and a `__Host-` or `__Secure-` cookie name needs `secure`. Every token must have an `exp`. A cookie's origin is checked against the request's `Host` and `origins` only: `x-forwarded-host` isn't trusted. `memoryAuthStore()` keeps owners and revocations in one process, and `pgAuthStore(db)` from `@haikit/auth/postgres`, with `migrate` and `schema`, in Postgres.

### Patch Changes

- Updated dependencies [e696ff4]
  - @haikit/core@0.29.0
