# Documentation

| | |
| --- | --- |
| [**spec.md**](spec.md) | Design spec — the dual channel, the contract split, elicit mode, the four guarantees, package topology |
| [**tutorial.md**](tutorial.md) | Build *Hello, World!* as a haikit app in nine steps, annotated line by line |

These Markdown files are the source of truth: edit them directly.

They were seeded from standalone HTML versions of the same content, which now
live outside the repo. `scripts/docs-from-artifacts.mjs` still performs that
conversion if you ever need to re-seed from an updated HTML export:

```bash
node scripts/docs-from-artifacts.mjs path/to/spec.html path/to/tutorial.html
```

It overwrites `spec.md` and `tutorial.md` wholesale, so any edits made here since
the last run are lost. If the HTML is gone for good, delete the script and drop
the `node-html-parser` devDependency with it.
