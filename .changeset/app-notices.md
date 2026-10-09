---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/postgres": minor
"@haikit/react": minor
---

The server can now tell a conversation something outside of any request, with a notice. Declare one with `defineNotice` (core) beside your surfaces, implement it with a required `model` function (what the model hears, or `null`), list it in `createHai({ notices })`, and send it with `hai.notify(conversationId, notice, payload, { handle })` from anywhere: a webhook, a job queue, an action handler's follow-up.

The payload is typed from the contract and checked against its schema before it is stored. It goes to the browser over a new route, `GET /hai/events`, which `hello` tells the client to open; the client resumes with `Last-Event-ID` after a dropped connection. The `model` text goes to the model in the next user message the conversation records, after any tool results, and is taken in on the fenced conversation row, so a turn whose save is lost leaves it unread. `notify` takes no lease, and a notice never starts a turn.

The client renders notices from a `notices` registry, passed to `createChat` or `mountChat`, with no `send`. `@haikit/react` adds `reactNotice`.

**Breaking for custom stores:** `StoreAdapter` gains `putNotice` and `getNotices`, and an optional `watch`. `memoryStore()` and `pgStore()` implement them. `@haikit/postgres`'s `migrate()` adds the `haikit_notices` table and two columns on `haikit_conversations`; pass `listen` to `pgStore` so the events route hears of notices at once rather than at its next two-second read.
