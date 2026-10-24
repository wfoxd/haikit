---
"@haikit/client": patch
---

A waiting tool row's arguments are now written in `--hai-on-accent` in full, like the tool's name, rather than at 70%; the bold name and the regular-weight arguments are set apart by weight. Dimmed, they fell under 4.5:1 in a palette with white `--hai-on-accent` on a darker `--hai-warn` (3.5:1 for white on `#9a5d08`). They now read as well as `--hai-on-accent` does on `--hai-warn`: 13.1:1 at the defaults, 5.3:1 for white on `#9a5d08`. An app that set `.hai-status-awaiting summary { --hai-dim: var(--hai-on-accent); }` to work around this can drop it.
