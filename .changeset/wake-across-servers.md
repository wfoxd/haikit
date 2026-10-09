---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/postgres": minor
---

Wake turns now reach browsers connected to other app servers. `StoreAdapter` gains two optional methods, `publish` and `subscribe`; `subscribe` resolves once it is listening, and the events route waits for that before opening a stream. The events route publishes a wake turn's frames through them, except the history's whole `context`, and every other server hands what it hears to its own streams. A tab that joins part way gets the reply so far. A store without the methods works as before: a wake turn reaches only the streams of the server running it.

`pgStore` publishes over `NOTIFY` on a new `haikit_turns` channel. A large frame is split into pieces and put back together on arrival, and frames are kept in order per conversation. It subscribes when given the `listen` connection it already takes for notices. Nothing is stored for the frames themselves. `memoryStore` delivers between Hai instances sharing it.

Wake turns are numbered: `Conversation.wakeTurns` counts them, failed ones included, and a wake turn's first `streaming` frame carries its number as `wake`. A frame heard from an older turn never takes over from a newer one. `pgStore`'s `migrate()` adds the `wake_turns` column, and a custom store must round-trip `wakeTurns`. `pgStore` refuses to publish a message longer than `MAX_PUBLISH_BYTES` (about 52 MB) instead of sending one no listener would accept.
