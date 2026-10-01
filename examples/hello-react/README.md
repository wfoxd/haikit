# hello-react

hello, with its surfaces written as React components. Example app — not
published. Like hello, it runs against the packages in this repo: its
`@haikit/*` dependencies are `"*"`, which the npm workspace satisfies with the
local `packages/*`.

Run from the repo root:

```bash
npm run example:hello-react
```

Then http://localhost:5176. It uses the scripted model, so it needs no API key.
To run it against Claude instead:

```bash
ANTHROPIC_API_KEY=… npm run dev -w hello-react
```

The server side is hello's, file for file. What differs is the browser half:

- `src/client/components.tsx`: the picker and the card as React components,
  typed from `src/shared/surfaces.ts` with `@haikit/react`. Compare
  `examples/hello/public/components.js`.
- `src/server/main.ts`: while developing, Vite runs inside this server as
  middleware, so the page, hot reload and `/hai` share one port with no proxy.
  With `NODE_ENV=production` it serves `dist/` instead.

For the production path, from the repo root:

```bash
npm run build                       # the local packages
npm run build -w hello-react        # vite build → examples/hello-react/dist/
HAI_SCRIPTED=1 npm start -w hello-react
```

`npm start` sets `NODE_ENV=production`, so the server serves `dist/` instead of
running Vite.
