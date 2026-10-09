# @haikit/react

## 0.13.0

### Minor Changes

- aeede82: The server can now tell a conversation something outside of any request, with a notice. Declare one with `defineNotice` (core) beside your surfaces, implement it with a required `model` function (what the model hears, or `null`), list it in `createHai({ notices })`, and send it with `hai.notify(conversationId, notice, payload, { handle })` from anywhere: a webhook, a job queue, an action handler's follow-up.

  The payload is typed from the contract and checked against its schema before it is stored. It goes to the browser over a new route, `GET /hai/events`, which `hello` tells the client to open; the client resumes with `Last-Event-ID` after a dropped connection. The `model` text goes to the model in the next user message the conversation records, after any tool results, and is taken in on the fenced conversation row, so a turn whose save is lost leaves it unread. `notify` takes no lease, and a notice never starts a turn.

  The client renders notices from a `notices` registry, passed to `createChat` or `mountChat`, with no `send`. `@haikit/react` adds `reactNotice`.

  **Breaking for custom stores:** `StoreAdapter` gains `putNotice` and `getNotices`, and an optional `watch`. `memoryStore()` and `pgStore()` implement them. `@haikit/postgres`'s `migrate()` adds the `haikit_notices` table and two columns on `haikit_conversations`; pass `listen` to `pgStore` so the events route hears of notices at once rather than at its next two-second read.

### Patch Changes

- Updated dependencies [aeede82]
  - @haikit/core@0.13.0
  - @haikit/client@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [e6c1f1c]
  - @haikit/core@0.12.0
  - @haikit/client@0.12.0

## 0.11.0

### Patch Changes

- @haikit/core@0.11.0
- @haikit/client@0.11.0

## 0.10.0

### Patch Changes

- @haikit/core@0.10.0
- @haikit/client@0.10.0

## 0.9.2

### Patch Changes

- Updated dependencies [c435274]
  - @haikit/client@0.9.2
  - @haikit/core@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [80adcb9]
  - @haikit/client@0.9.1
  - @haikit/core@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [f403915]
  - @haikit/client@0.9.0
  - @haikit/core@0.9.0

## 0.8.0

### Minor Changes

- e0d6760: New package: `@haikit/react`, for writing surface components in React.

  `reactSurface(Component)` builds a registry entry around a React component. `SurfaceProps<typeof yourSurface>` types the component's props from the same `defineSurface` contract the server implements: `props` from its schema, and `send(action, value)` against the actions it declares. The component also gets `mode`, `state`, `selection` and `expired`.

  The first render is synchronous, so the surface has its height when the transcript scrolls to it. The root re-renders on freeze and expiry, and is unmounted when the surface goes away, so effects clean up. `react` and `react-dom` 18 or 19 are peer dependencies.

  `examples/hello-react` is hello with React components, built with Vite.

### Patch Changes

- Updated dependencies [6c11020]
  - @haikit/client@0.8.0
  - @haikit/core@0.8.0
