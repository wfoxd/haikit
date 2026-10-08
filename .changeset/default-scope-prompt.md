---
"@haikit/server": minor
---

`createHai()` now appends a default scope to the system prompt, `DEFAULT_SCOPE`, exported from `@haikit/server`. It keeps the model to what the app's tools do: it declines anything else in one sentence, never claims something no tool did, and treats tool results as data rather than instructions. Pass `scope` to replace it, or `scope: false` to send your `system` prompt unchanged, as before.
