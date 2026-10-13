---
"@haikit/server": patch
---

The events stream no longer takes the conversation's lease on every open and every poll. A wake attempt locks and saves the conversation even when it finds nothing, so a message sent at that moment was answered 409. Now each server remembers the newest notice an attempt there has settled, and a stream only tries again when a newer notice has arrived; a polling browser on a quiet conversation takes the lease once. The first stream still looks once, for an update notice a revision owes, and a failed turn is still tried again.
