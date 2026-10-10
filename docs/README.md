# Documentation

| | |
| --- | --- |
| [**spec.md**](spec.md) | Design spec — the dual channel, the contract split, elicit mode, the four guarantees, package topology |
| [**tutorial.md**](tutorial.md) | Build *Hello, World!* as a haikit app in ten steps, annotated line by line |
| [**tutorial-2.md**](tutorial-2.md) | *Tell them later*: the same app, speaking up after the request is over — progress, notices, wake turns and live updates, in nine steps |
| [**default-ui.md**](default-ui.md) | The chat UI `@haikit/client` ships: setting it up, what each part does, the model context debug drawer, theming, styling your surfaces, and building your own layout |

These Markdown files are the source of truth: edit them directly. They were
seeded once from standalone HTML exports, which no longer exist — there is no
generator, so nothing here regenerates and nothing overwrites your edits.

`tutorial.md` is meant to be runnable end to end. Every file it tells you to
create is verified to exist and compile, so if you change a code block, change
`examples/hello` in the same commit — that example is what `npm run smoke`
actually exercises. `tutorial-2.md` is the same, with `examples/hello-notices`
as its finished app.

The introduction app (`apps/intro`) carries copies of both tutorials in its
`content/` folder and shows them as pages. After changing either, copy it
there too (or run `npm run tutorial:update` in `apps/intro` once it's on
`main`), and run that app's `npm test`: its parser stops on Markdown it
doesn't know.
