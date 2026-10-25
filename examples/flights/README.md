# flights

Example app — not published. Run from the repo root:

```bash
npm run example:flights
```

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.

The browser half is Vite's, as in `examples/hello`: the table, the seat map and
the notices in `src/client/components.js` style themselves with Tailwind
classes, and `src/client/styles.css` imports `@haikit/client/tailwind.css`. For
the production path, from the repo root:

```bash
npm run build                  # the local packages
npm run build -w flights       # vite build → examples/flights/dist/
NODE_ENV=production HAI_SCRIPTED=1 npm start -w flights
```
