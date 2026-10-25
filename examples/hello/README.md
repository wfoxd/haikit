# hello

Example app — not published. It runs against the packages in this repo, not
the ones on npm: its `@haikit/*` dependencies are `"*"`, which the npm
workspace always satisfies with the local `packages/*`. That makes it the place
to try changes before they are released.

Run from the repo root:

```bash
npm run example:hello
```

That rebuilds the local packages first, so it always runs your current code.
`npm start` inside this folder skips that, and runs against whatever the
packages last built.

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.

The browser half is Vite's. The components in `src/client/components.js` style
themselves with Tailwind classes, and `src/client/styles.css` imports
`@haikit/client/tailwind.css`, which brings the default UI's stylesheet and
HaiKIT's colours as theme values. While developing, Vite runs inside the
server, so the page, hot reload and `/hai` share one port. For the production
path, from the repo root:

```bash
npm run build                  # the local packages
npm run build -w hello         # vite build → examples/hello/dist/
NODE_ENV=production HAI_SCRIPTED=1 npm start -w hello
```
