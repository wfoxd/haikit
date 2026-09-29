---
"@haikit/server": minor
"@haikit/client": minor
---

`createHai({ init })` runs a tool at the start of every conversation, before
the user types anything and before the model's first turn. The runtime makes
the call itself, so the model can't skip it. The call and its result go into
the history as if the model had made them.

- **Before any input.** The new `POST /hai/start` route opens a conversation
  and runs `init` without calling the model. The client's new `chat.start()`
  calls it, and `mountChat` does so when it opens and after *Start a new
  conversation*. The Messages API requires the history to begin with a user
  message, so it opens with `[conversation started]`, followed by init's call
  and result. Without an `init`, `/start` returns an empty stream and creates
  no conversation. A client that never calls `start()` still gets `init`, run
  with its first message.
- It gets `{}` as input and can render surfaces. An elicit surface parks the
  conversation before anyone has typed. The user's answer becomes the result,
  and the model replies.
- If it throws, the request is refused and nothing is recorded, so the next
  start or message tries again. If another request takes over the lease
  during initialisation, the fence stops it the same way.
- It stays in the model's tool list for the whole conversation, because
  changing that list mid-conversation invalidates newer models' earlier
  reasoning. A later call from the model returns "already ran" without running
  it.
- `createHai` refuses an `init` whose name clashes with another tool or with
  `query_ui`.
