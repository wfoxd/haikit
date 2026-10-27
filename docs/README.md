# Documentation

| | |
| --- | --- |
| [**spec.md**](spec.md) | Design spec — the dual channel, the contract split, elicit mode, the four guarantees, package topology |
| [**tutorial.md**](tutorial.md) | Build *Hello, World!* as a haikit app in ten steps, annotated line by line |
| [**tutorial-2.md**](tutorial-2.md) | *Tell them later*: the same app, speaking up after the request is over — progress, notices, wake turns and live updates, in nine steps |
| [**tutorial-3.md**](tutorial-3.md) | *Who's asking*: the same app, signed in with `@haikit/auth` — your own login, the gate, the model knowing who it's talking to, and sign out everywhere, in nine steps |
| [**shadcn.md**](shadcn.md) | shadcn/ui in a HaiKIT app: the colours from the tokens, `dark:` following the chat, providers around each surface, toasts and pop-ups |
| [**default-ui.md**](default-ui.md) | The chat UI `@haikit/client` ships: setting it up, what each part does, the model context debug drawer, theming, styling your surfaces, and building your own layout |
| [**design/default-ui-tokens-and-states.pdf**](design/default-ui-tokens-and-states.pdf) | The default UI's design: every `--hai-*` token's light and dark value, each tool row state, notices and system cards, the empty conversation, and surface patterns built from the tokens. `hai.css` follows it |
| [**design/dock-bar.pdf**](design/dock-bar.pdf) | The dock's design: a surface docked to the shelf on the composer and opened as a window, wide and on a phone, in light and dark, with every item, shelf, pile, surface bar and window state and the tokens each uses |
| [**reference/**](reference/index.md) | The reference manual: every public function, type and option, package by package, with every default, limit and error, checked against the source |

These Markdown files are the source of truth: edit them directly. They were
seeded once from standalone HTML exports, which no longer exist — there is no
generator, so nothing here regenerates and nothing overwrites your edits.

`tutorial.md` is meant to be runnable end to end. Every file it tells you to
create is verified to exist and compile, so if you change a code block, change
`examples/hello` in the same commit — that example is what `npm run smoke`
actually exercises. `tutorial-2.md` is the same, with `examples/hello-notices`
as its finished app, and `tutorial-3.md` with `examples/hello-auth`.

The introduction app (`apps/intro`) carries copies of the three tutorials and
of the reference manual in its `content/` folder and shows them as pages.
After changing a tutorial, copy it there too (or run `npm run docs:update` in
`apps/intro` once it's on `main`), and run that app's `npm test`: its parsers
stop on Markdown they don't know, and on a reference link that leads nowhere.