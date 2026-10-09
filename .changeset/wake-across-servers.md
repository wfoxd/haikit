---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/postgres": minor
---

Wake turns now reach browsers connected to other app servers. `StoreAdapter` gains two optional methods, `publish` and `subscribe`. The events route publishes a wake turn's frames through them, except the history's whole `context`, and every other server hands what it hears to its own streams. A tab that joins part way gets the reply so far. A store without the methods works as before: a wake turn reaches only the streams of the server running it.

`pgStore` publishes over `NOTIFY` on a new `haikit_turns` channel. A large frame is split into pieces and put back together on arrival, and frames are kept in order per conversation. It subscribes when given the `listen` connection it already takes for notices. Nothing new is stored, so there is nothing to migrate. `memoryStore` delivers between Hai instances sharing it.
