---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
---

Signals: short-lived broadcasts to every open browser, such as how many people are online. `defineSignal({ name, version, payload })` declares one in the shared contract, `createHai({ signals })` registers it, and `hai.signal(signal, payload)` sends it, typed from the contract and checked against its schema. It goes to every open events stream, on this server and, through a store with `publish` and `subscribe`, on the others. It is never stored or numbered, never reaches the model, and is never drawn in the transcript. Each signal's latest payload is kept and sent first to a stream that opens later. On the wire it is a new `signal` event, with no id.

Presence: `hai.onPresence(listener)` hears how many conversations have an events stream open, across servers sharing the store, now and whenever it changes. A closed stream still counts for `presence.graceMs` (default 5 s), so reconnects don't flicker the count, and servers exchange counts every `presence.heartbeatMs` (default 10 s). `hai.streamOpened(conversationId, emit)` is what the events route calls, for anyone serving the stream themselves.

The client takes `signals` handlers by name (`createChat`, `mountChat`), keeps each signal's latest payload in `state.signals`, and lets subscribers hear the `signal` event.
