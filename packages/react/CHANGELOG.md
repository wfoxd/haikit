# @haikit/react

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
