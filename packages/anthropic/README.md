# @haikit/anthropic

Model adapter for Claude.

```ts
import { anthropic } from "@haikit/anthropic";
createHai({ model: anthropic({ model: "claude-opus-5", effort: "medium" }), … });
```

Note it imports only `@haikit/core`, never `@haikit/server`. Adapters implement an
interface the contract layer declares — that is what keeps the runtime
swappable, and what lets an app ship its own adapter without forking anything
(see `examples/*/src/server/scripted.ts`).

The agent loop is hand-written rather than using the SDK's tool runner: an
`elicit` turn must stop mid-turn, return an HTTP response, and resume from a
*different request*. An in-process iterator cannot cross that boundary.
