---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/postgres": minor
---

App code can now revise a surface from outside any turn, closing #65. `hai.update(conversationId, surface, handle, props, { model?, wake?, timeoutMs? })` is `ctx.update` for code that isn't a tool, such as a price feed moving a fare. It's typed from the surface's contract, takes the conversation's lease, and writes the revision through the same fenced path, under the same rules. While a turn holds the conversation, it waits up to `timeoutMs` (default 30 s), then throws `ConversationBusy`. `handle` may be any handle the surface has had; the revision replaces the latest. A question waiting on the surface waits on the revision. Bursts for one surface coalesce: one write in flight, and the newest call waiting behind it, which every call it replaced resolves with.

It then appends an *update notice* (`NoticeRecord.replaces`). The events stream sends that notice to the browser as the revision's `ui_open` (with `replaces`) and `ui_props`, and the browser swaps the new props into the component on screen. The model hears, in the next user message, which handle replaced which, with the new digest, after the app's optional `model` sentence. With `wake: true` it hears at once, in a turn started under the wake-notice rules. It needs `createHai({ updates: true })`, which opens the events stream and lets an update wake.

The client resumes the events stream from the last frame id it saw, update notices included, and counts a revision's deadline from when the server stored it. A tool row whose question was revised now resolves when the revision is answered.

The revision and the update notice it owes commit together on the conversation row (`Conversation.announcing`). If appending the notice fails, the next request, wake or update appends it first; delivery is at least once.

**For custom stores:** a `NoticeRecord` may carry `replaces`, and a `Conversation` may carry `announcing` (an update notice, or null). A store must return both as given. `@haikit/postgres`'s `migrate()` adds the columns.
