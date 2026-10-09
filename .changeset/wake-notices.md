---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/postgres": minor
---

A notice can now start a turn of its own. Declare it with `defineNotice({ kind: "wake", … })`. Its `model` function must return text, since the turn is the model's answer to it; `null` is a compile error. Send it with `hai.notify`, as before.

The turn runs where a browser is watching: the events route takes the conversation's lease and streams the turn down `GET /hai/events`, retrying with backoff while the conversation is busy. It doesn't start while a question waits, before the conversation has begun, once it is out of date, or past `maxWakes` (new in `createHai`, by default one wake turn a minute per conversation). In those cases the notice rides the user's next message, as a passive one does. `hai.wake(conversationId, emit)` is exported for apps that serve the events stream themselves. The client queues `send` and `interact` behind a wake turn instead of being refused with a 409.

**For custom stores:** a `NoticeRecord` may carry `kind: "wake"`, and a `Conversation` may carry `wakes` and `wokeThrough`. A store must return all three exactly as given. `@haikit/postgres`'s `migrate()` adds the columns.
