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
If saving the click fails after the handler has written (a crash, a newer
request taking the conversation over, a failed write), nothing is recorded, and
clicking again runs the handler again, perhaps with a different value. A
`resolve` is recorded at most once per surface, so a `resolve` handler that
writes should upsert on `(conversationId, handle)`. Handles are unique only
within a conversation, and the last attempt is the one recorded. An `inform`
surface takes any number of clicks, so an `inform` handler that writes needs a
write that's safe to repeat, or a key of its own.

**A model reply asks one question at a time.** Claude can make several tool
calls in one reply, but the turn waits on one surface. The first elicit
surface a reply renders is shown; a later one is neither stored nor shown, and
its call gets `Not shown: ui_01 is already waiting for the user. Ask this again
after it is answered.` So every `tool_use` still gets a result, and the model
can ask again once the first is answered. Display surfaces are not limited.
The turn waits on the question a call showed, even if the tool returns
something else; that return follows the question's digest in the answer. A
call that asks and then throws has its question withdrawn, so another call in
the same reply can ask instead. Every render a tool starts finishes before its
call is decided, and a render after the tool has returned shows nothing.

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
