---
"@haikit/core": patch
"@haikit/server": patch
"@haikit/client": patch
---

Revisions (`ctx.update`) are rechecked for freshness before they're stored, so a turn that outlasts a surface's window can't bring an out-of-date conversation back by superseding that surface. A question revised by a later call in the same reply now goes to the model under the revision's digest, with anything the asking call said after its question kept (even when the asking call revised it itself first), and an empty digest kept as given. A wake turn's snapshot keeps a revision's `replaces` and the original's tool row, and lists the surface's earlier handles in a new `ui_open.alsoReplaces`, so a browser that reconnects mid-turn swaps the surface in place, even after several revisions, rather than showing it twice. A notice naming any earlier handle of a revised surface, including one the browser never saw, is shown beside the surface as it is now.
