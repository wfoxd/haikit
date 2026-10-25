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

The browser half is React with [shadcn/ui](https://ui.shadcn.com), built by
Vite. The two surfaces in `src/client/components.tsx` are React components,
registered with `reactSurface` from `@haikit/react`, and built from the shadcn
components in `src/client/components/ui/`. Those came from
`npx shadcn@latest init -b radix -p lyra` and
`npx shadcn@latest add card toggle-group button badge tooltip`, and
`components.json` is there so `add` works in this folder. Each surface is a
React root of its own, so the tooltips' provider goes around each one as
`reactSurface`'s `wrapper`.

`src/client/globals.css` imports Tailwind, `@haikit/client/tailwind.css`,
which brings the default UI's stylesheet and HaiKIT's colours as theme values,
and shadcn's own CSS. It then points shadcn's colours at the `--hai-*` tokens,
and makes `dark:` follow the chat's scheme and its `data-hai-theme` pin, so
the surfaces follow the chat in light and dark. While developing, Vite runs
inside the server, so the page, hot reload and `/hai` share one port. For the
production path, from the repo root:

```bash
npm run build                  # the local packages
npm run build -w hello         # vite build → examples/hello/dist/
NODE_ENV=production HAI_SCRIPTED=1 npm start -w hello
```
