# @haikit/core

The contract layer. Isomorphic, zero runtime dependencies — imported by the
server runtime, the browser client, every adapter, and both halves of your app.

```ts
import { defineSurface, resolve, query } from "@haikit/core";

export const picker = defineSurface({
  name: "flight_table",
  version: 1,
  props: z.object({ flights: z.array(Flight) }),
  actions: { select: resolve(z.string()) },
  queries: { filter: query(FilterArgs) },
});
```

Schemas are accepted **structurally** — anything with a `.parse()` method works,
so zod is your choice rather than this package's dependency.

## The four guarantees

Enforced in the type system, and asserted by `test/types/guarantees.ts`:

| | |
|---|---|
| a surface cannot exist without a `digest`, nor a notice without its `model` text | both are required fields |
| a query's result can only be produced by `cap()` | `Capped` has no other constructor |
| `mode: "elicit"` needs a `resolve` action | otherwise the call does not typecheck |
| an undeclared action does not exist | the contract *is* the allowlist |

A surface can also declare `staleAfterMs`, how long its data may be acted on:
milliseconds, or `"never"`, which is the default. Once any surface in a
conversation is past its window, the conversation closes.

A notice, declared with `defineNotice`, is something the server tells a
conversation outside of any request. Its payload goes to the browser and its
`model` text to the model, in the next user message; `model` returns `null`
when the model needn't hear it. `hai.notify` types the payload from the
contract. A notice declared with `kind: "wake"` also starts a turn, so its
`model` must return text: `null` is a compile error.

`npm run typetest` at the repo root compiles those tests twice — once with their
`@ts-expect-error` directives (must be clean) and once stripped (every marked
line must error). A guarantee that silently stops working fails CI.
