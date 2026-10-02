# @haikit/client

Browser runtime. Plain ESM, no build step.

```js
import { mountChat } from "@haikit/client/app.js";
mountChat({ root, registry, suggestions: ["…"] });
```

`mountChat` is the ten-line path: it builds the shell, wires the composer,
renders the transcript and mounts your surfaces. It is a convenience, not the
API — it is built from `createChat` + `renderTranscript`, and dropping to those
when the default shell stops fitting is the expected path.

`hai.css` styles **only what the framework renders** — transcript blocks, tool
rows, the surface container, shell, composer, debug drawer. It deliberately does
not style the inside of your surfaces; your components emit their own class
names and your stylesheet owns them. Every colour is a `--hai-*` custom
property, so override what you like.

## The default UI

`mountChat` gives you a header with **New chat** and a **Context** button that
shows how many tokens the model holds, a centred conversation, and a composer
that grows as you type.

**Context** opens the *model context debug drawer*: every message, tool call
and digest the model receives, and how much of the payload stayed out of
context. It starts closed and slides in from the right. On a wide screen the
chat makes room for it, and on a narrow one it opens over the chat. Escape or
its close button shuts it. It opens again after a reload if it was open
before. `inspector: false` leaves it out.

Each tool row says where its call stands: running, `awaiting you` while the turn
is parked on its surface, `resolved` once that surface has been answered or
typed over, or how long it took. Expand it to see the input and the
`tool_result`, which is everything the model received.

It is light or dark with the system. To pin it, put `data-hai-theme="dark"` (or
`"light"`) on the `<html>` element, or pass `theme: "dark"` to `mountChat`.

### Tokens

Every token is set at zero specificity, so a plain `:root` rule in your own
sheet wins. Give a colour one value per scheme with `light-dark()`:

```css
:root { --hai-accent: light-dark(#6d28d9, #b07cff); }
```

| | |
|---|---|
| `--hai-bg` `--hai-panel` `--hai-panel-2` | page, cards, secondary panels |
| `--hai-fg` `--hai-dim` | text, secondary text |
| `--hai-line` `--hai-line-soft` | borders, row dividers |
| `--hai-accent` `--hai-on-accent` | the accent, and text drawn on it |
| `--hai-good` `--hai-warn` `--hai-bad` | status colours; each, and the accent, has a `-soft` tint for backgrounds |
| `--hai-hover` `--hai-selected` | row hover and picked-row backgrounds, for your surfaces |
| `--hai-user-bg` `--hai-code-bg` `--hai-shadow` | user bubble, digest blocks, card shadow |
| `--hai-radius` `--hai-sans` `--hai-mono` | shape and type |
| `--hai-column` `--hai-inspector-width` | conversation width, debug drawer width |

## Surface lifecycle

The default transcript keeps each block's element for as long as what it
shows is unchanged, so a surface mounts **once** and keeps its own state — a
filter, an expanded row, a React tree — while the conversation streams on.
`mount` may return `{ freeze, expire, unmount }`. `unmount` is called when the
surface goes away: `chat.reset()` starts a new conversation, `chat.close()`
ends the chat, or the surface is mounted again. Release there whatever `mount`
set up.

`chat.close()` is for good: anything open is aborted, every surface is
unmounted, and subscribers hear `{ type: "closed" }`. `mountChat` then removes
its shell. A page using `renderTranscript` directly calls `closeTranscript(root)`
when it removes a transcript, so its resize observer and scroll listener let go.

## Out-of-date conversations

The server closes a conversation once any surface passes its freshness window.
The client knows each window too, so a tab left open closes on time instead of
looking live until a click is refused: `state.expired` holds the notice,
`send` and `interact` stop sending, and each surface's element is made `inert`
with `data-expired` set. `chat.reset()` starts a new conversation; the default
transcript renders the notice with a button that calls it.

## Serving it

This package ships source, not a bundle. With a bundler, import normally. With
no bundler, serve `node_modules/@haikit/client/src/` under a URL prefix — the
examples mount it at `/hai-client/`.
