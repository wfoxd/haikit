---
"@haikit/auth": minor
---

Sign in with Google, or any OpenID Connect provider. `@haikit/auth/oidc` exports `google()` and `oidc()`, and `createAuth`'s new `providers` option takes what they return. `auth.handler` then answers `GET /auth/<name>`, which sends the browser to the provider, and `GET` the path of its `redirectUri`. On the way back it checks the answer and calls `signIn`, so the user gets the same cookie as one your own login signs in. The code flow carries PKCE, a `state` and a `nonce`, in an encrypted, 10-minute `__Host-haikit_sign_in` cookie. A sign-in that fails goes to the provider's `failureUrl`, with `?sign_in_error=` set to `access_denied`, `refused`, `expired` or `failed`. A user is `google:<sub>` by default, and a `user(profile)` hook can map them to your own id or refuse them. `google({ hostedDomain })` keeps sign-in to one Workspace domain. The new `SignInProvider` type is the contract for a provider of your own.
