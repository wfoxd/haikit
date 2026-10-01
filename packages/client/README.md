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
rows, the surface container, shell, composer, inspector. It deliberately does
not style the inside of your surfaces; your components emit their own class
names and your stylesheet owns them. Every colour is a `--hai-*` custom
property, so override what you like.

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
