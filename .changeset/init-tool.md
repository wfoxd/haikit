---
"@haikit/server": minor
---

`createHai({ init })` runs a tool at the start of every conversation, before
the model's first turn. The runtime makes the call itself, so the model can't
skip it. The call and its result go into the history after the user's first
message, as if the model had made them.

- It gets `{}` as input and can render surfaces. An elicit surface parks the
  conversation before the model runs, and the user's answer becomes the result.
- If it throws, the request is refused and nothing is recorded, not even the
  user's message, so the next message tries again. If another request takes
  over the lease mid-initialisation, the fence stops it the same way.
- It stays in the model's tool list for the whole conversation, because
  changing that list mid-conversation invalidates newer models' earlier
  reasoning. A later call from the model returns "already ran" without running
  it.
- `createHai` refuses an `init` whose name clashes with another tool or with
  `query_ui`.
