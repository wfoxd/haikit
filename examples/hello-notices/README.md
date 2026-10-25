# hello-notices

Example app — not published. The finished app of the second tutorial,
*Tell them later* (`docs/tutorial-2.md`): the first tutorial's hello app,
taught to speak up after the request is over.

- `list_greetings` reports progress while it works (`ctx.progress`).
- Choosing a greeting posts it as a postcard (`src/server/postOffice.ts`);
  delivery arrives later as a notice beside the picker (`hai.notify`).
- The pen pal's reply is a wake notice: the model tells the user unasked.
- A little after a picker is shown, translators add a language to it in place
  (`src/server/translators.ts`, `hai.update`).

Like `examples/hello`, it runs against the packages in this repo, not the ones
on npm. Run from the repo root:

```bash
npm run example:hello-notices
```

That rebuilds the local packages first. Uses the scripted model in
`src/server/scripted.ts`, so it needs no API key. Drop `HAI_SCRIPTED=1` and set
`ANTHROPIC_API_KEY` to run it against Claude.

The browser half is Vite's, as in `examples/hello`: the components and notices
in `src/client/components.js` style themselves with Tailwind classes, and
`src/client/styles.css` imports `@haikit/client/tailwind.css`. For the
production path, from the repo root:

```bash
npm run build                        # the local packages
npm run build -w hello-notices       # vite build → examples/hello-notices/dist/
NODE_ENV=production HAI_SCRIPTED=1 npm start -w hello-notices
```
