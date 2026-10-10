# @haikit/react

Write haikit surface components in React.

```bash
npm install @haikit/react react react-dom
```

```tsx
import { useState } from "react";
import { reactSurface, type SurfaceProps } from "@haikit/react";
import type { greetingPicker } from "../shared/surfaces.ts";

function GreetingPicker({ props, send, mode, state, selection }: SurfaceProps<typeof greetingPicker>) {
  const [script, setScript] = useState<string | null>(null); // local state: never reaches the server
  const live = state === "live" && mode === "elicit";
  return (
    <div className="rows">
      {props.greetings
        .filter((g) => !script || g.script === script)
        .map((g) =>
          live ? (
            <button key={g.code} type="button" onClick={() => send("choose", g.code)}>
              {g.text}
            </button>
          ) : (
            <div key={g.code} className={g.code === selection ? "picked" : undefined}>
              {g.text}
            </div>
          ),
        )}
    </div>
  );
}

export const registry = { greeting_picker: reactSurface(GreetingPicker) };
```

Pass `registry` to `mountChat` or `createChat` as usual. The client's contract
doesn't change: a registry entry is anything with `mount(element, props, ctx)`,
and `reactSurface` builds one around a React component.

## What the component gets

`SurfaceProps<typeof yourSurface>` is typed from the same `defineSurface`
contract the server implements:

| prop | |
|---|---|
| `props` | the surface's props, as its `props` schema produced them |
| `send(action, value)` | the only channel to the server: an action the contract declares, with a value of its input type. Anything else is a compile error |
| `mode` | how the surface was opened: `elicit` as a question the turn waits on, `display` as something shown. It stays `elicit` once answered |
| `state` | `live`, or `frozen` once answered: a resolved question can't be answered again |
| `selection` | what the user picked, once frozen |
| `expired` | the conversation is out of date; nothing here can reach the server again |

Import the contract with `import type`. Only the types are needed, so the
schemas and their library stay out of the browser bundle.

## Notices

`reactNotice` does the same for a notice, from the same `defineNotice` contract
the server sends it with. `NoticeProps<typeof yourNotice>` gives the component
`payload`, typed from the contract, its `seq`, and the `handle` of the surface
it sits beside, if any. There is no `send`: a notice cannot reach the server.

```tsx
import type { holdConfirmed } from "../shared/notices";

function HoldConfirmed({ payload }: NoticeProps<typeof holdConfirmed>) {
  return <p>Fare held · {payload.flightId} · ref {payload.reference}</p>;
}

mountChat({ root, registry, notices: { hold_confirmed: reactNotice(HoldConfirmed) } });
```

## Lifecycle

The default transcript mounts a surface **once**, so `useState` survives the
conversation streaming on around it. The root re-renders when the surface
freezes, when a tool revises it in place (`ctx.update`), with the new props and
its state kept, or when the conversation goes out of date. It is unmounted when the surface
goes away, on `chat.reset()` or `chat.close()`, so effects clean up after
themselves. The first render is synchronous, so the surface already has its
height when the transcript scrolls to it.

React escapes text by default. Keep it that way: tool payloads are untrusted
input, so never pass them to `dangerouslySetInnerHTML`.

## Building

React needs a bundler. `examples/hello-react` in the haikit repo runs Vite
inside its own node server while developing, so the app and `/hai` share one
port with no proxy, and serves `vite build`'s output in production.
