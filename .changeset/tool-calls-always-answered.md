---
"@haikit/server": patch
---

Every tool call in the history now gets a result, so the model API never refuses a conversation for good. A reply that stops for another reason with tool calls in it, such as `max_tokens` part way through a call, no longer leaves them unanswered: none runs, each is answered `Not run: …`, and the turn goes on so the model can answer or try again. A reply with `stop_reason: "tool_use"` and no call ends the turn rather than recording an empty message. A tool that returns nothing is answered `<name> returned no result.`, or with its question's digest, and one that throws a value that isn't an `Error` is answered with that value as text, rather than crashing the turn.
