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

**An action's handler runs only for a click the turn can accept**: a
`resolve` on the surface the turn is waiting for, or an `inform` while nothing
waits. Any other click is refused before the handler sees it, so a handler can
write, and can be async to do it. It gets `{ props, handle, conversationId }`.
If it throws, nothing is recorded and the user can click again. Once it
succeeds, the click is saved before the model runs, so it can't be answered
twice.

That makes a handler run at least once per recorded click, not exactly once.
If saving the click fails after the handler has written (a crash, a request
that lost its lease to a newer one, a failed write), nothing is recorded, and
clicking again runs the handler again. Key what it writes on `handle`, which is
unique per render, so the second run writes nothing.

**`init` runs a tool at the start of every conversation**, before the user
types anything. The runtime makes the call, not the model, so it can't be
skipped: the call and its result go into the history as if the model had made
them.

```ts
const hai = createHai({ model, store, tools, surfaces, system, init: loadProfile });
```

A third route, `POST /hai/start`, opens the conversation and runs `init`
without calling the model. The client's `start()` calls it, and `mountChat`
does so when it opens and after *Start a new conversation*. The Messages API
requires the history to begin with a user message, so it opens with
`[conversation started]`, followed by init's call and result. Without an
`init`, `/start` returns an empty stream and creates no conversation. A client
that never calls `start()` still gets `init`, run with the first message.

It gets `{}` as input and can render surfaces. An elicit surface ("which
account?") parks the conversation before anyone has typed; the answer becomes
init's result, and the model replies. If it throws, the request is refused and
nothing is recorded, so the next start or message tries again. It stays in the model's tool list, because changing that list
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
