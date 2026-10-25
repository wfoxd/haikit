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
rows, the surface container, shell, composer, debug drawer, dock. It deliberately does
not style the inside of your surfaces; your components emit their own class
names and your stylesheet owns them. Every colour is a `--hai-*` custom
property, so override what you like.

With Tailwind CSS v4, import `tailwind.css` instead: it brings `hai.css`, and
gives your surfaces the tokens as theme values, as in `bg-hai-panel` or
`text-hai-dim`.

```css
@import "tailwindcss";
@import "@haikit/client/tailwind.css";
```

The look is neo-brutalist: hard 3px borders, offset shadows, square corners,
in Space Grotesk and Space Mono. `hai.css` names those faces but doesn't load
them; link them on your page, or the system's faces stand in.

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

Every surface has a **Dock** button on its bar. Docked, it waits on a shelf
above the message box and opens from there as a window, one at a time; **Put
back** or **Remove from dock** returns it to its place. It's moved, not
mounted again, so your component keeps its state. A docked question stays
amber on the shelf, when the shelf is full the oldest go into a pile, and
**Remove all** at the shelf's end puts every docked surface back at once.
`dock: false` leaves it out.

It is light or dark with the system. To pin it, put `data-hai-theme="dark"` (or
`"light"`) on the `<html>` element, or pass `theme: "dark"` to `mountChat`.

### Tokens

Every token is set at zero specificity, so a plain `:root` rule in your own
sheet wins. Give a colour one value per scheme with `light-dark()`:

```css
:root { --hai-accent: #b07cff; }
@supports (color: light-dark(#000, #fff)) {
  :root { --hai-accent: light-dark(#9f7aea, #b07cff); }
}
```

Keep the plain value first. A browser without `light-dark()` gets hai.css's
dark scheme, and an override it can't read would leave that token with no
colour at all. Keep the accent light enough for ink text, too:
`--hai-on-accent` writes on it and on the amber `--hai-warn` alike.

| | |
|---|---|
| `--hai-bg` `--hai-panel` `--hai-panel-2` | page, cards, secondary panels |
| `--hai-fg` `--hai-dim` | text, secondary text |
| `--hai-line` `--hai-line-soft` | borders, row dividers |
| `--hai-accent` `--hai-on-accent` | the accent, and text drawn on it |
| `--hai-good` `--hai-warn` `--hai-bad` | status colours; each, and the accent, has a `-soft` tint for backgrounds. `--hai-warn` is a fill: write on it in `--hai-on-accent` |
| `--hai-hover` `--hai-selected` | row hover and picked-row backgrounds, for your surfaces |
| `--hai-user-bg` `--hai-code-bg` `--hai-shadow` | user messages and notice labels, code blocks, the offset card shadow |
| `--hai-radius` `--hai-sans` `--hai-mono` | shape and type |
| `--hai-column` `--hai-inspector-width` | conversation width, debug drawer width |

## Surface lifecycle

The default transcript keeps each block's element for as long as what it
shows is unchanged, so a surface mounts **once** and keeps its own state — a
filter, an expanded row, a React tree — while the conversation streams on.
`mount` may return `{ freeze, expire, unmount, update }`. `unmount` is called
when the surface goes away: `chat.reset()` starts a new conversation,
`chat.close()` ends the chat, or the surface is mounted again. Release there
whatever `mount` set up.

**A tool can revise a surface in place** (`ctx.update`). The revision arrives
as a `ui_open` naming the handle it `replaces`. The client moves the surface's
record and transcript block to the new handle, keeping the same element, and
hands the new props to `update(props)`. Implement it to keep what the
component holds, such as its scroll, sort or a row the user picked. Without
it, the component is mounted again in place. Either way, `ctx.send` names the
surface's current handle, so a click after a revision reaches the new one.
Each surface keeps its own deadline, and a replaced surface's stops counting.
A revision app code makes from outside a turn (`hai.update`) arrives the same
way, on the events stream, and its deadline counts from when the server
stored it.

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

If something on the network holds the stream back, as HTTPS-inspecting
corporate proxies (Netskope, Zscaler) do, the chat polls instead. The server
greets every stream with a comment the moment it opens. A stream that brings
no bytes at all within `eventsFallbackMs` (default 8 s, an option of
`createChat` and `mountChat`) is dropped for short polls, whose responses end and so get through.
Notices, signals and wake turns all arrive by polling, a little later than
they would stream. Each poll asks the server to hold for `pollHoldMs`
(default 15 s, the server's maximum) when nothing is new; set it lower
behind a proxy that drops requests sooner. The browser remembers it had to poll, in `localStorage`
under `hai:events-poll`, for a day, so its next page polls from the start.

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

## Signals

A signal (`hai.signal`) is a broadcast to every open browser, such as how many
people are online. It comes down the same events stream, and goes to a
handler, never to the transcript:

```js
mountChat({
  root, registry,
  signals: {
    online(payload, { version }) {
      badge.textContent = `${payload.count} reading now`;
    },
  },
});
```

Each signal's latest payload is also in `state.signals`, by name, and
subscribers hear a `signal` event. A stream that opens is sent each signal's
latest value first, so the handler runs as soon as the events stream is up.
Signals carry no id: a reconnect is sent the latest values again rather than
the ones it missed.

## Out-of-date conversations

The server closes a conversation once any surface passes its freshness window.
The client knows each window too, so a tab left open closes on time instead of
looking live until a click is refused: `state.expired` holds the notice,
`send` and `interact` stop sending, and each surface's element is made `inert`
with `data-expired` set.

The browser counts each window from when it sent the request that rendered
the surface, which is never later than the server's own stamp, so its
deadline is never later than the server's. Each surface also comes with
`ageMs`, how long ago the server stored it: the time its digest took, plus,
for one replayed to a stream that joined a wake turn part way, how long it
waited. The window is counted from whichever is earlier. That's a duration,
not a time, so the two clocks are never compared. `chat.reset()` starts a new conversation; the default
transcript renders the notice with a button that calls it.

## Serving it

This package ships source, not a bundle. With a bundler, import normally, as
the examples do with Vite. With no bundler, serve
`node_modules/@haikit/client/src/` under a URL prefix — `apps/rebook` in
HaiKIT's repository mounts it at `/hai-client/`.
