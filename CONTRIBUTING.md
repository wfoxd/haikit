# Contributing

```bash
npm install
npm test          # typecheck + typetest + smoke
npm run packtest  # pack the tarballs, install them clean, use them
```

## Layout

```
packages/core        contracts — the four type guarantees live here
packages/server      runtime, elicit state machine, routes
packages/client      browser runtime + default UI (plain ESM, no build)
packages/anthropic   model adapter
examples/*           demonstrations. private, never published
scripts/             typetest.mjs, smoke.mjs, packtest.mjs
```

## Two rules with teeth

**Adapters never import the runtime.** `@haikit/anthropic` and any store adapter
depend on `@haikit/core` only. If an adapter needs something from `@haikit/server`,
that something belongs in core as an interface.

**`@haikit/client` never imports `@haikit/server`.** The only thing crossing that line
is an app's own contract module. If the client needs a type, it comes from
`@haikit/core`.

## Changing a guarantee

The four type-level guarantees are asserted in
`packages/core/test/types/guarantees.ts`. If you change one, change the test in
the same commit — `npm run typetest` fails both when a guarantee stops being
enforced *and* when a `@ts-expect-error` becomes stale.

## Packaging

`npm test` runs entirely inside the workspace, where every import resolves
through a symlink to the source tree. That makes a whole class of bug invisible:
a path missing from `files`, an `exports` target that does not exist, a `.d.ts`
that was never emitted, a type dependency that only resolved because the repo
root happened to have it.

`npm run packtest` packs the real tarballs, installs them into a directory
outside the workspace, and uses them — imports every entry point, exercises
`cap()` and the store, and type-checks a consumer against the shipped `.d.ts`
files with `skipLibCheck` off. If you touch `files`, `exports`, `types`, or any
public signature, run it.

## Releasing

Changesets, with the four packages version-locked:

```bash
npx changeset          # describe the change
```

Merging to `main` opens a "Version Packages" PR; merging that publishes. The
release workflow runs `npm test` and `npm run packtest` before it will publish
anything.

Auth is **trusted publishing**: npm verifies the release workflow's OIDC identity
against a trusted publisher configured on each of the four packages
(npmjs.com → package → Settings → Trusted Publisher → `wfoxd/haikit`,
`release.yml`). There is no `NPM_TOKEN` anywhere — nothing to rotate, nothing to
leak. Provenance comes with it, so published tarballs carry a signed attestation
tying them to the workflow run that built them.

Two things that quietly break it: removing `id-token: write` from the workflow
permissions, and renaming `release.yml` without updating the trusted publisher
config on all four packages.

Before the first publish, run the whole gate locally:

```bash
npm run prepublish-check
```
