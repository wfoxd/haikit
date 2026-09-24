# Documentation

| | |
| --- | --- |
| [**spec.md**](spec.md) | Design spec — the dual channel, the contract split, elicit mode, the four guarantees, package topology |
| [**tutorial.md**](tutorial.md) | Build *Hello, World!* as a haikit app in nine steps, annotated line by line |

These Markdown files are the source of truth: edit them directly. They were
seeded once from standalone HTML exports, which no longer exist — there is no
generator, so nothing here regenerates and nothing overwrites your edits.

`tutorial.md` is meant to be runnable end to end. Every file it tells you to
create is verified to exist and compile, so if you change a code block, change
`examples/hello` in the same commit — that example is what `npm run smoke`
actually exercises.
