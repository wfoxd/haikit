---
"@haikit/server": patch
---

`memoryStore({ leaseMs })` now rejects a zero, negative, `NaN` or infinite TTL
with a `RangeError` instead of accepting it.

A TTL of zero or less made every lease expire the moment it was taken, so every
`loadConversation` succeeded and two requests could hold one conversation at
once — the one-turn-in-flight guarantee was silently off. An infinite TTL would
have stranded a crashed turn's conversation forever. Omitting `leaseMs` keeps the
default of two minutes.
