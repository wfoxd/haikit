# @haikit/server

The runtime: agent loop, elicit state machine, the interaction security
boundary, and a derived `query_ui`.

```ts
import { createHai, memoryStore, nodeHandler } from "@haikit/server";

const hai = createHai({ model, store: memoryStore(), tools, surfaces, system });
const handle = nodeHandler(hai, "/hai");
```

Two routes: `POST /hai/chat` and `POST /hai/interact`, both streaming SSE.

**`/hai/interact` accepts `{handle, action, value}` and nothing else.** What an
action *means* is resolved server-side from the surface's declared contract. If
the client could name a tool, a prompt injection inside any tool result would
become a button wired to it.

**`init` runs a tool at the start of every conversation**, before the model's
first turn. The runtime makes the call, not the model, so it can't be skipped:
the call and its result go into the history after the user's first message, as
if the model had made them.

```ts
const hai = createHai({ model, store, tools, surfaces, system, init: loadProfile });
```

It gets `{}` as input and can render surfaces. An elicit surface ("which
account?") parks the conversation before the model runs at all. If it throws,
the request is refused and nothing is recorded, so the next message tries
again. It stays in the model's tool list, because changing that list
mid-conversation invalidates newer models' earlier reasoning. But a later call
from the model gets "already ran" instead of running it twice. Its result stays
in context for every turn, so keep it digest-sized.

**A conversation closes once any of its surfaces passes its `staleAfterMs`.**
From then on both routes answer with an `expired` event and the model is not
called, so a picker left open over a weekend cannot resolve against last week's
data. The user starts a new conversation. A surface that declares no window
never goes stale, so set one wherever the data can change.

`memoryStore()` is for development. A parked elicit turn is durable state —
lose `pending` and that conversation can never be sent again. Ship with
[`@haikit/postgres`](https://www.npmjs.com/package/@haikit/postgres).
