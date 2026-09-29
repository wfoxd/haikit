---
"@haikit/core": minor
"@haikit/server": minor
---

Action handlers can be async, so a click can write. A handler may return `Promise<string>`, and its context now includes `conversationId`.

A handler runs only for a click that will be recorded: a `resolve` on the surface the turn is waiting for, or an `inform` while nothing waits. Any other click is refused before the handler runs. If the handler throws, the click is refused with `action failed: …`, nothing is recorded, and the surface stays live for another try. Once it succeeds, the click is saved before the model runs, so a model turn that outlasts the lease can no longer lose it and let it be answered twice.

Fixed: an `inform` click while a turn was waiting on another surface added a user message after a `tool_use` with no `tool_result`, which the API refuses, and that history was saved. It is now refused with "a question is waiting to be answered first".
