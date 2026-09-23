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

## Serving it

This package ships source, not a bundle. With a bundler, import normally. With
no bundler, serve `node_modules/@haikit/client/src/` under a URL prefix — the
examples mount it at `/hai-client/`.
