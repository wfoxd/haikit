---
"@haikit/openai": minor
---

New package: `@haikit/openai`, a model adapter for OpenAI models over the Responses API. `openai({ model, maxTokens, effort, apiKey, baseURL, promptCacheKey })` defaults to `gpt-6-luna` with `effort: "medium"`. It sends the whole history on every call with `store: false`, translating HaiKIT's history into Responses API input and the reply back, and keeps encrypted reasoning items in the history so they go back with the next call. A tool keeps strict mode only when its schema meets OpenAI's strict rules; any other tool is sent with `strict: false`.
