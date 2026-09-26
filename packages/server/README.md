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

`memoryStore()` is for development. A parked elicit turn is durable state —
lose `pending` and that conversation can never be sent again. Ship with
[`@haikit/postgres`](https://www.npmjs.com/package/@haikit/postgres).
