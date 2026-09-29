---
"@haikit/core": minor
"@haikit/server": minor
---

Action handlers can be async, so a click can write. A handler may return `Promise<string>`, and its context now includes `conversationId`.

A handler runs only for a click the turn can accept: a `resolve` on the surface the turn is waiting for, or an `inform` while nothing waits. Any other click is refused before the handler runs. If the handler throws, the click is refused with `action failed: …`, nothing is recorded, and the surface stays live for another try. Once it succeeds, the click is saved before the model runs, so a model turn that outlasts the lease can no longer lose it.

A handler runs at least once per recorded click, not exactly once. If saving the click fails after the handler has run (a crash, a newer request taking the conversation over, a failed write), nothing is recorded, and clicking again runs it again, perhaps with a different value. A `resolve` handler that writes should upsert on `(conversationId, handle)`: handles are unique only within a conversation, and the last attempt is the one recorded. An `inform` surface takes any number of clicks, so an `inform` handler that writes needs a write that is safe to repeat, or a key of its own.

Fixed: an `inform` click while a turn was waiting on another surface added a user message after a `tool_use` with no `tool_result`, which the API refuses, and that history was saved. It is now refused with "a question is waiting to be answered first".
