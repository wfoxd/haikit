---
"@haikit/server": patch
---

Block ids no longer repeat across servers or restarts. They counted from 1 in each `Hai`, but the browser matches blocks by id for a whole conversation, across POST responses and the events stream, so a block from a second server sharing the store, or from a restarted one, overwrote an earlier block in place. Ids are now `b_<random part per Hai>_<n>`.
