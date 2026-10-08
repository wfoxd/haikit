---
"@haikit/anthropic": minor
---

`anthropic()` now defaults to `claude-haiku-5-5` instead of `claude-opus-5`. An app that passes no `model` now runs Claude Haiku 5.5: faster and cheaper, at the same `medium` effort. Pass `model: "claude-opus-5"`, or any other model ID, to choose a different one.
