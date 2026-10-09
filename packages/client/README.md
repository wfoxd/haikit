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

The [default UI guide](https://github.com/wfoxd/haikit/blob/main/docs/default-ui.md)
covers it in full: every option, what each part of the screen does, theming,
styling your surfaces, and building your own layout. In short:

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
:root { --hai-accent: #b07cff; }
@supports (color: light-dark(#000, #fff)) {
  :root { --hai-accent: light-dark(#6d28d9, #b07cff); }
}
```

Keep the plain value first. A browser without `light-dark()` gets hai.css's
dark scheme, and an override it can't read would leave that token with no
colour at all.

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

## Notices

When the server sends notices (`hai.notify`), its `hello` says so, and the chat
keeps `GET /hai/events` open for the conversation. A dropped connection
reconnects, backing off, and resumes after the last notice it saw, so none is
missed or shown twice. `reset()` and `close()` end it.

Each notice lands in `state.notices` and as a `notice` block: right after its
surface's block when it names one, otherwise at the end. Its component comes
from a `notices` registry, kept apart from the surface registry so the two
never clash on a name:

```js
mountChat({
  root, registry,
  notices: {
    hold_confirmed: {
      mount(el, payload, { seq, handle }) {
        el.textContent = `Fare held · ${payload.flightId} · ref ${payload.reference}`;
      },
    },
  },
});
```

A `wake` notice's turn comes down the same stream: its reply appears under the
notice like any other. While it runs, `send` and `interact` wait for it to
finish rather than being refused, just as they wait behind this chat's own
requests. If the events connection drops mid-turn, the turn runs on without
a way to say when it ends, so the next request keeps trying, backing off, for
up to two minutes rather than giving up after one retry.

A notice's component gets **no `send`**: nothing in it can reach the server. A
name the registry doesn't list renders an error card. Like a surface, `mount`
may return `{ unmount }`. With `createChat`, mount one yourself with
`chat.mountNotice(seq, element)`.

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
