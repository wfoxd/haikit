---
"@haikit/mcp": patch
---

An `oauth()` refresh that GitHub refuses now asks the user to connect again. GitHub's token endpoint refuses an expired or revoked refresh token with `bad_refresh_token`, and a client it doesn't know with `incorrect_client_credentials`, its own words for `invalid_grant` and `invalid_client`, and sends both with a 200. Before this, only `invalid_grant`, `invalid_client` and `unauthorized_client` counted as a refusal, so a GitHub App user who revoked the app on GitHub, or whose six-month refresh token expired, had every call fail with reason `connection`, `<server>/<tool> could not be reached`, for good. Now the credential is deleted and the call rejects with reason `auth`, kind `reconnect`, so the app can show its connect card. Any other `error`, a 5xx, or no answer still rejects with `connection` and keeps the credential.
