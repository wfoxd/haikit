---
"@haikit/server": patch
---

Revisions (`ctx.update`) are rechecked for freshness before they're stored, so a turn that outlasts a surface's window can't bring an out-of-date conversation back by superseding that surface. A question revised by a later call in the same reply now goes to the model under the revision's digest. A wake turn's snapshot keeps a revision's `replaces` and the original's tool row, so a browser that reconnects mid-turn swaps the surface in place rather than showing it twice.
