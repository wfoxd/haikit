---
"@haikit/auth": minor
---

Sign in with GitHub, or any OAuth 2.0 provider that doesn't speak OpenID Connect. `@haikit/auth/oauth2` exports `github()` and `oauth2()`, which `createAuth`'s `providers` takes as it takes `google()`: the same two routes, the same flow cookie, and the same `signIn` at the end. The code flow carries PKCE and a `state`. There's no ID token to say who signed in, so the code is exchanged for an access token, and `oauth2()`'s `profile(api)` reads the user from the provider's API with `api.get`, which sends the token as a Bearer token, to https URLs only, and follows no redirect; the token is dropped once the profile is read. A GitHub user is `github:<id>` by default, with their name (their login when they set none) and their verified primary email, read from `/user/emails`. `OAuth2Profile` has the same shape as `OidcProfile`, so one `user` function serves both.
