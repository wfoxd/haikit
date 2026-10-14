# React

`@haikit/react` turns a React component into a surface or notice component
for the client's registries. It's typed from the same `defineSurface` or
`defineNotice` contract the server implements, so a prop or an action that
changes there stops the browser side compiling.

Exported by `@haikit/react`: `reactSurface`, `SurfaceProps`, `reactNotice`,
`NoticeProps`.

Checked against `@haikit/*` 0.20.0. Source: `packages/react/src/index.ts`.

```bash
npm install @haikit/react react react-dom
```

Its peer dependencies are `react` and `react-dom`, version 18 or 19. With
TypeScript, also install `@types/react`. `@haikit/react` depends on
`@haikit/client` and `@haikit/core` at exactly its own version, so install
that same version of `@haikit/client`, or the app gets two copies. React needs
a bundler: `examples/hello-react` runs Vite inside its own Node server while
developing, and serves `vite build`'s output in production.

`PropsOf<S>`, `ActionsOf<S>` and `PayloadOf<N>` below are internal and not
exported: the `P` and `A` of `Surface<P, A, Q>`, and the `P` of
`Notice<P, K>`. Use `SurfaceProps<typeof x>["props"]` to name a surface's
props type.

## `reactSurface`

```ts
function reactSurface<S extends Surface<any, ActionMap, QueryMap>>(
  Component: ComponentType<SurfaceProps<S>>,
): ComponentDef<PropsOf<S>>;
```

Returns a registry entry (a `ComponentDef`, see
[The browser client](client.md#registry-componentdef)) that renders
`Component` into the surface's element. `S` is the surface contract's type,
`typeof yourSurface`.

```tsx
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { greetingPicker } from "../shared/surfaces.ts";

function GreetingPicker({ props, send, mode, state, selection }: SurfaceProps<typeof greetingPicker>) {
  const live = state === "live" && mode === "elicit";
  return props.greetings.map((g) =>
    live ? <button key={g.code} onClick={() => send("choose", g.code)}>{g.text}</button>
         : <div key={g.code} className={g.code === selection ? "picked" : undefined}>{g.text}</div>,
  );
}

export const registry = { greeting_picker: reactSurface(GreetingPicker) };
```

Import the contract with `import type`: only its types are needed, so the
schemas and their library stay out of the browser bundle.

**What the entry does:**

- **On mount,** it creates a React root on the element and renders
  `Component` synchronously (with `flushSync`), so the surface has its height
  when the transcript scrolls to it. That only works when `mount` isn't called
  from inside React's rendering: a transcript built in React should call
  `chat.mount` from a `queueMicrotask`, as the default transcript does, not
  directly from an effect.
- **If that first render throws:**
  - with React 18, the root is unmounted and the error rethrown, so `mount`
    throws. The surface stays blank: the client has no instance to freeze,
    update or mount again;
  - with React 19, `mount` returns normally with an empty element, and React
    reports the error (to `window.reportError` by default). The next freeze,
    revision or expiry renders it again.

  Neither stacks a second root on the element.
- **It renders again,** asynchronously as React does, when the surface:
  - freezes: `state` becomes `"frozen"`, and `selection` the picked value, or
    `undefined` when the question was closed out or withdrawn. Only an elicit
    surface freezes;
  - is revised in place: new `props`, with the component and its state kept;
  - expires: `expired` becomes `true`.
- **An error in a later render** isn't caught: React removes the tree, and
  the surface goes blank. Wrap the component in an error boundary of your own
  for a fallback.
- **Each surface is its own React root.** The app's context providers (theme,
  router, data client) don't reach it, and nothing adds `StrictMode` or an
  error boundary. Render any providers inside the component you pass.
- **On unmount,** it unmounts the root, so effects clean up. That happens
  when the surface goes away: `chat.reset()`, `chat.close()`, or mounting it
  again.

The default transcript mounts each surface once, so a component's state
survives the conversation streaming on around it.

## `SurfaceProps`

```ts
interface SurfaceProps<S extends Surface<any, ActionMap, QueryMap>> {
  props: PropsOf<S>;
  mode: SurfaceMode;
  state: SurfaceState;
  selection?: unknown;
  expired: boolean;
  send<K extends keyof ActionsOf<S> & string>(action: K, value: Infer<ActionsOf<S>[K]["input"]>): Promise<void>;
}
```

| Prop | Meaning |
| --- | --- |
| `props` | The surface's props, typed from the contract. At runtime, the JSON form of what the server's schema returned (see [Surfaces: schemas](surfaces.md#schemas)) |
| `mode` | `"elicit"` for a question the turn waits on, `"display"` for something shown. It stays `"elicit"` once answered; `state` changes |
| `state` | `"live"`, or `"frozen"` once answered, closed out or withdrawn. Only an elicit surface freezes: a display surface stays `"live"` |
| `selection` | What the user picked, once frozen by a click. Also set when the surface is mounted already frozen |
| `expired` | `true` once the conversation is out of date. By then the element is `inert`, so nothing in it can reach the server. A surface mounted after the conversation expired renders once with `false`, then again with `true` |
| `send` | The only way to the server: an action the contract declares, with a value of its input type. Anything else doesn't compile. See below |

**`send` in detail.** It's the client's `send` (see
[`MountCtx`](client.md#mountctx)), created once per mount, so it keeps the
same identity across renders, and is safe in hook dependency lists. After a
revision it names the new handle.

- **It's dropped,** resolving at once, while any request of the chat is open
  or queued (including the turn that rendered this surface, while it
  streams), once the conversation has expired, and after `close()`.
- **Otherwise it resolves when the whole response has been read,** which for
  a `resolve` includes the model turn it resumes. A refused click resolves
  too: the refusal appears as an `error` block. So the promise doesn't say
  whether the click was accepted. It rejects only if the request fails.
- **It isn't blocked on a frozen surface.** The server refuses the click
  (`component is frozen`). Check `state` before offering it, as the example
  does.
- **The value's type is the schema's output type** (`Infer`), which is what
  compiles, but the value is sent as JSON and parsed again on the server. For
  a schema that transforms, coerces or fills defaults, what compiles isn't
  necessarily what the server's `parse` accepts. A `Date`, for instance,
  compiles but arrives as a string.

The component isn't given its handle. Its props are typed as the contract's
`P`, so a prop that doesn't survive JSON, such as a `Date`, is typed as one
but arrives as a string. The same goes for `selection`.

## `reactNotice`

```ts
function reactNotice<N extends Notice<any, any>>(
  Component: ComponentType<NoticeProps<N>>,
): NoticeDef<PayloadOf<N>>;
```

Returns a notices registry entry (a `NoticeDef`, see
[The browser client](client.md#noticeregistry-noticedef)) that renders
`Component` into the notice's element. `N` is the notice contract's type. A
wake notice renders as a passive one does.

```tsx
import { reactNotice, type NoticeProps } from "@haikit/react";
import type { holdConfirmed } from "../shared/notices";

function HoldConfirmed({ payload }: NoticeProps<typeof holdConfirmed>) {
  return <p>Fare held · {payload.flightId} · ref {payload.reference}</p>;
}

mountChat({ root, registry, notices: { hold_confirmed: reactNotice(HoldConfirmed) } });
```

As with `reactSurface`, the first render is synchronous, a throwing first
render behaves the same way, each notice is its own root, and the root is
unmounted when the notice goes away. A notice is rendered once: nothing
about it changes.

## `NoticeProps`

```ts
interface NoticeProps<N extends Notice<any, any>> {
  payload: PayloadOf<N>;
  seq: number;
  handle?: string;
}
```

| Prop | Meaning |
| --- | --- |
| `payload` | The notice's payload, typed from the contract. Delivered as JSON, so the JSON caveat above applies |
| `seq` | Its sequence number in the conversation |
| `handle` | The handle the notice was sent with, if any. It may name an earlier revision of the surface it's shown beside |

There's no `send`: a notice can't reach the server. The notice's `version`
isn't passed.

## Safety

React escapes text by default. Keep it that way: tool payloads are untrusted
input, so never pass them to `dangerouslySetInnerHTML`.
