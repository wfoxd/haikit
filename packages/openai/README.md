# @haikit/openai

Model adapter for OpenAI models, over the Responses API.

```ts
import { openai } from "@haikit/openai";
createHai({ model: openai({ model: "gpt-6-luna", effort: "medium" }), … });
```

With no `model`, it uses `gpt-6-luna`; pass any other model ID to change it.
`effort` defaults to `medium`; pass `effort: null` for a model that doesn't
reason, such as `gpt-4.1`, and no reasoning settings are sent. The key comes
from `OPENAI_API_KEY` unless you pass `apiKey`.

Note it imports only `@haikit/core`, never `@haikit/server`. Adapters implement an
interface the contract layer declares — that is what keeps the runtime
swappable, and what lets an app ship its own adapter without forking anything
(see `examples/*/src/server/scripted.ts`).

HaiKIT keeps the history in the Anthropic Messages shape, so this adapter
translates it into Responses API input on every call, and the reply back. It
sends the whole history each time with `store: false` rather than chaining
`previous_response_id`: the conversation lives in your store, not OpenAI's.
Reasoning items come back encrypted and are kept in the history, so the next
call can send them back.

A tool keeps strict mode only when OpenAI's strict mode accepts its schema:
every object lists all its properties in `required` and sets
`additionalProperties: false`. Any other tool is sent with `strict: false`.

A conversation begun with this adapter can't be continued with
`@haikit/anthropic`, or the other way round: each provider's reasoning blocks
mean nothing to the other.
