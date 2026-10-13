---
"@haikit/server": patch
"@haikit/postgres": patch
---

A message or tool result holding U+0000, or a lone surrogate, no longer locks the conversation. `pgStore` stores each as U+FFFD, in jsonb strings and keys and in text parameters, where Postgres used to refuse the write; `memoryStore` does the same, so development matches. And `nodeHandler` never rejects: a failed closing save becomes an `error` event, a store failure before the response starts a 500, a body that isn't a JSON object a 400, and each is logged, so no request is left open.
