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
`npm start` inside this folder skips the build and runs whatever `dist/` was
last built.

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.
