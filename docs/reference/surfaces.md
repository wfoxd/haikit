# Surfaces

A surface is a component a tool shows in the conversation. Its contract is
declared once and imported by both halves. The server implements it, with a
digest and handlers, and the browser renders it with the component
registered under its name.

Everything on this page is exported by `@haikit/core`. The behaviour
described comes from `@haikit/server`, which runs the implementations.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts` and
`packages/server/src/runtime.ts`.

- [Schemas](#schemas): `Schema`, `Infer`
- [Declaring a contract](#declaring-a-contract): `defineSurface`, `Surface`,
  `resolve`, `inform`, `query`, `ActionKind`, `ActionSpec`, `ActionMap`,
  `QuerySpec`, `QueryMap`
- [Implementing it](#implementing-it): `Surface.implement`, `SurfaceImplDef`,
  `SurfaceImpl`, `AnySurfaceImpl`, `DigestCtx`, `ActionCtx`, `QueryCtx`
- [Freshness](#freshness): `staleAfterMs`, and how a conversation expires
- [Elicit mode in the types](#elicit-mode-in-the-types): `HasResolve`,
  `ElicitOptions`
- [When the types are bypassed](#when-the-types-are-bypassed)

## Schemas

### `Schema<T>`

```ts
interface Schema<T> {
  parse(value: unknown): T;
}
```

Any object with a `parse` method that returns the value it accepts or throws.
HaiKIT calls it as a method, `schema.parse(value)`.

- **A zod schema fits as it is.**
- **A valibot schema needs wrapping.** Valibot parses with a free function,
  so pass `{ parse: (value) => v.parse(schema, value) }`.
- **So does a hand-written one.**

HaiKIT calls `parse` on everything that crosses into the server. When it
throws:

| What | When | If `parse` throws |
| --- | --- | --- |
| A surface's props | `ctx.render`, `ctx.update` and `hai.update`, before anything is stored | `ctx.render` and `ctx.update` throw the schema's error to the tool, which fails with `<tool> failed: <message>` unless it catches it. Inside the init tool, the request fails with `initialisation failed: <message>`. `hai.update` rejects with it |
| An action's value | `POST /interact`, before the handler runs | the click is refused: `invalid action payload: <message>` |
| A query's arguments | each `query_ui` call, on `args`, or on `{}` when the model leaves `args` out | the model gets `Invalid args for "<query>": <message>` |
| A tool's input | each tool call, before `run` | the model gets `Invalid input for <tool>: <message>` |
| A notice's payload | `hai.notify`, before it's stored | `hai.notify` rejects with it |
| A signal's payload | `hai.signal`, before it's sent | `hai.signal` throws it |

The value `parse` returns, not the value it was given, is what HaiKIT stores
and sends. A schema that transforms (trims, coerces, fills defaults)
therefore changes what's stored.

**Props must survive JSON.** A store keeps a payload's props as JSON:
`memoryStore` copies them through `JSON.stringify` and `JSON.parse`, and
`pgStore` keeps them in a `jsonb` column. The digest gets the value `parse`
returned. Everything later reads the stored copy: action handlers, query
handlers, and the revision frames the events stream sends for `hai.update`.
The browser receives props as JSON in any case. So what doesn't survive JSON
is changed or lost by then:

- a `Date` arrives as a string, though `P` says `Date`;
- `undefined` fields disappear;
- a `BigInt` makes storing throw;
- U+0000 and lone surrogates become U+FFFD, in both built-in stores;
- with `pgStore`, an object's keys come back in `jsonb`'s order (shorter keys
  first), not the order they were rendered in.

HaiKIT only ever calls `parse`. It can't inspect a schema, so it can't turn one
into JSON Schema. That's why a tool needs `inputJsonSchema` and a query takes
`argsJsonSchema`.

### `Infer<S>`

```ts
type Infer<S> = S extends Schema<infer T> ? T : never;
```

The type a schema parses to. HaiKIT uses it to type action handlers' values
and query handlers' arguments.

## Declaring a contract

### `defineSurface`

```ts
function defineSurface<P, A extends ActionMap = {}, Q extends QueryMap = {}>(def: {
  name: string;
  version: number;
  props: Schema<P>;
  actions?: A;
  queries?: Q;
}): Surface<P, A, Q>;
```

Declares a surface's contract. Put it in a module both halves import: the
server calls `.implement()` on what this returns, and the browser renders
against the same props type.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | required | The surface's name. The server registers the implementation under it, every payload records it, and the browser looks up the component of that name in its registry |
| `version` | `number` | required | Recorded on every payload and sent to the browser in `ui_open`, where the client keeps it on the surface's record (`chat.state.surfaces`). A component's `mount` isn't given it. HaiKIT doesn't compare versions |
| `props` | `Schema<P>` | required | Validates the props a tool renders. `P` is the props type on both halves |
| `actions` | `A` | `{}` | Every interaction that may reach the server, by name, each made with `resolve` or `inform` |
| `queries` | `Q` | `{}` | Every query the model may run on this surface's payload, by name, each made with `query` |

**Returns** a `Surface<P, A, Q>`.

**Behaviour.**

- `actions` is the complete list of what a component can send. Anything a
  component does that isn't listed stays in the browser: there's no channel
  for it. The server refuses an action name the contract doesn't list (see
  [How a click is handled](#how-a-click-is-handled)).
- Nothing is checked when you call it. The name and version aren't
  validated, and no registry is touched.

**Example.**

```ts
import { z } from "zod";
import { defineSurface, query, resolve } from "@haikit/core";

export const flightResults = defineSurface({
  name: "flight_results",
  version: 1,
  props: z.object({ flights: z.array(z.object({ id: z.string(), price: z.number() })) }),
  actions: { pick: resolve(z.object({ flightId: z.string() })) },
  queries: {
    under: query(
      z.object({ maxPrice: z.number() }),
      "Flights at or below a price",
      { type: "object", properties: { maxPrice: { type: "number" } }, required: ["maxPrice"] },
    ),
  },
});
```

### `Surface<P, A, Q>`

```ts
interface Surface<P, A extends ActionMap, Q extends QueryMap> {
  readonly name: string;
  readonly version: number;
  readonly props: Schema<P>;
  readonly actions: A;
  readonly queries: Q;
  implement(impl: SurfaceImplDef<P, A, Q>): SurfaceImpl<P, A, Q>;
}
```

What `defineSurface` returns: the fields it was given, with `actions` and
`queries` set to `{}` when left out, and `implement`. See
[`Surface.implement`](#surfaceimplement).

### `resolve`

```ts
const resolve: <V>(input: Schema<V>) => ActionSpec<"resolve", V>;
```

Declares an action that answers the question a turn is parked on. Returns
`{ kind: "resolve", input }`.

A `resolve` click is accepted only for the surface the conversation is
waiting on. It's recorded once at most: the surface is then frozen.

### `inform`

```ts
const inform: <V>(input: Schema<V>) => ActionSpec<"inform", V>;
```

Declares an action that tells the model something without having blocked the
conversation. Returns `{ kind: "inform", input }`.

An `inform` click is accepted on any live surface in the history while no
question is waiting, any number of times.

### `query`

```ts
const query: <A>(
  input: Schema<A>,
  description?: string,
  argsJsonSchema?: JsonSchema,
) => QuerySpec<A>;
```

Declares a named, read-only way into the surface's stored payload. Returns
`{ input, description, argsJsonSchema }`. There's no other way to read a
payload: the model can't ask for the raw data.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `input` | `Schema<A>` | required | Validates the arguments the model passes |
| `description` | `string` | none | Shown to the model in `query_ui`'s description, after the query's name |
| `argsJsonSchema` | `JsonSchema` | none | The arguments' JSON Schema, shown to the model in `query_ui`'s description |

**Leave out `argsJsonSchema` and the model can't see the parameters.**
`query_ui` lists the query with `args: (undeclared — omit them)`, so the model
calls it with no arguments, and the query's schema gets `{}`. If the schema
requires any argument, every call fails with `Invalid args for "<query>":
<message>`. If every argument is optional, every filter matches everything.
`createHai` warns once, when it starts, naming each query that has none:

```
[haikit] query_ui: no argsJsonSchema for flight_results.under. The model cannot see these
parameters and will call the query with no arguments. A query that genuinely takes none
should declare { type: "object", properties: {} }.
```

(One line in the console; wrapped here.)

### `ActionKind`, `ActionSpec`, `ActionMap`

```ts
type ActionKind = "resolve" | "inform";

interface ActionSpec<K extends ActionKind = ActionKind, V = unknown> {
  kind: K;
  input: Schema<V>;
}

type ActionMap = Record<string, ActionSpec<ActionKind, any>>;
```

What `resolve` and `inform` return, and the shape of a contract's `actions`.

### `QuerySpec`, `QueryMap`

```ts
interface QuerySpec<A = unknown> {
  input: Schema<A>;
  description?: string;
  argsJsonSchema?: JsonSchema;
}

type QueryMap = Record<string, QuerySpec<any>>;
```

What `query` returns, and the shape of a contract's `queries`.

## Implementing it

### `Surface.implement`

```ts
implement(impl: SurfaceImplDef<P, A, Q>): SurfaceImpl<P, A, Q>;
```

Pairs the contract with its server half. Returns `{ surface, impl }`. Call it
on the server only, and list the result in `createHai({ surfaces })`.

**Registration.** `createHai` registers each implementation under its
surface's name. It throws a `RangeError` for an invalid `staleAfterMs` (see
[Freshness](#freshness)), and a `TypeError` for an action whose kind isn't
`"resolve"` or `"inform"`, or that has no `input` schema with a `parse`
method (see [When the types are bypassed](#when-the-types-are-bypassed)). Two
implementations with the same name don't make it throw: the later one in the
list silently replaces the earlier.

`hai.update` rejects an implementation that isn't the one registered under
its name, with `surface "<name>" is not registered: list it in createHai({
surfaces })`. `ctx.render` and `ctx.update` don't check registration, but a
payload whose surface isn't registered can't be clicked
(`unknown component: <name>`) or queried. Nor is an unregistered
implementation's `staleAfterMs` checked: an invalid one is recorded as it is,
and the conversation then expires at its next request, with `… can no longer
be checked.` (see [Freshness](#freshness)).

### `SurfaceImplDef<P, A, Q>`

```ts
interface SurfaceImplDef<P, A extends ActionMap, Q extends QueryMap> {
  digest: (props: P, ctx: DigestCtx) => string;
  actions: {
    [K in keyof A]: (value: Infer<A[K]["input"]>, ctx: ActionCtx<P>) => string | Promise<string>;
  };
  queries: { [K in keyof Q]: (args: Infer<Q[K]["input"]>, ctx: QueryCtx<P>) => Capped };
  staleAfterMs?: number | "never";
}
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `digest` | `(props, { handle }) => string` | required | What the model gets in place of the payload |
| `actions` | one handler per declared action | required (`{}` when there are none) | Runs for an accepted click and returns its label |
| `queries` | one handler per declared query | required (`{}` when there are none) | Answers a `query_ui` call with a capped result |
| `staleAfterMs` | `number \| "never"` | `"never"` | How long the data may be acted on, from when it's stored. See [Freshness](#freshness) |

#### `digest`

Called once per render or revision: after the props are validated and the
payload is stored, and before the surface is sent to the browser. It receives
the validated props and `{ handle }`, the new payload's handle. It must be
synchronous and return a string. Anything else, a promise included, fails
the render with a `TypeError`: `surface <name>: digest must return a string
(got <type>)`, and a promise's rejection is caught rather than left
unhandled. Where what it returns goes:

- **A display surface:** `ctx.render` resolves to `{ model: <digest>, handle }`.
  The model gets whatever the tool returns, normally that.
- **An elicit surface:** the digest is held until the question is answered.
  The question's tool result is then the digest, then, each on a new line,
  any other text the asking tool returned, and the `resolve` handler's label
  (or the note that the user typed instead). If the tool that asked throws,
  the digest is discarded, and the model hears only `<tool> failed:
  <message>`.
- **A revision by `ctx.update`:** it resolves to `{ model: <new digest>,
  handle }`, as `render` does. When the revised surface is the question the
  reply is waiting on, the answer goes out under the new digest.
- **A revision by `hai.update`:** the end of the update notice's model text,
  `… Now: <digest>` (see [Revisions](revisions.md#how-the-model-hears-of-it)).
  A question waiting on the surface keeps the digest it was asked under, and
  the update's text follows the answer.

If `digest` throws, the payload stays stored, but its handle never joins the
history and nothing reaches the browser. In a tool, the error goes to the
tool, and from there to the model as `<tool> failed: <message>` unless the
tool catches it. In `hai.update`, the call rejects with it.

A digest is the model's whole view of the surface. Put in it what the next
turn or two will need, such as the cheapest and fastest options with their
ids, not just a count.

#### Action handlers

Each declared action needs a handler. It receives the value, validated by the
action's schema, and an `ActionCtx`. It returns the click's *label*, a string
for the model (directly or as a promise).

- **It runs only for a click the conversation can accept.** Every check in
  [How a click is handled](#how-a-click-is-handled) comes first, so a
  handler may write.
- **If it throws, the click is refused.** Nothing is recorded, and the surface
  stays live. The browser gets an `error` event, `action failed: <message>`.
  A handler that wrote before throwing should undo its own work.
- **It runs at least once per recorded click, not exactly once.** If the
  click can't be saved after the handler ran, nothing is recorded and the user
  can click again. That happens when the process crashes, or when another
  request took the conversation over. The handler then runs again, perhaps
  with a different value.
  - A `resolve` is recorded at most once per surface, so a `resolve` handler
    that writes should upsert on `(conversationId, handle)`. The last attempt
    is the one recorded. Handles are unique only within a conversation.
  - An `inform` surface takes any number of clicks. An `inform` handler that
    writes needs a write that's safe to repeat, or a key of its own.
- **A notice its work sends rides with the click.** Unread notices are read
  after the handler returns, so one the handler sent with `hai.notify` reaches
  the model in the same message.

#### Query handlers

Each declared query needs a handler. It receives the arguments, validated by
the query's schema, and a `QueryCtx`. It must return a `Capped` value, which
only a `Cap` function makes: `ctx.cap`, or one from `makeCap`. Use `ctx.cap`,
whose total is set for you. The handler must be synchronous. A promise isn't
awaited (see [When the types are bypassed](#when-the-types-are-bypassed)).

The handler reads the payload from `ctx.props`, the stored copy (see
[Schemas](#schemas)). It filters or sorts it, and passes the
rows it wants shown to `ctx.cap`, with a function that formats one row as a
line. `cap`'s first line counts the rows passed in against the surface's
whole collection. That's the first prop of the stored copy whose value is an
array, in the stored copy's key order, or 0 with no array prop. With `pgStore`
that order is `jsonb`'s, shorter keys first, so give a queried surface one
array prop, or the total may count a different array than with
`memoryStore`. See [`makeCap`](tools.md#makecap) for exactly what `cap`
keeps.

**How `query_ui` answers.** The model calls
`query_ui({ handle, query, args? })`, and the tool result it gets back is one
of:

| Case | Tool result |
| --- | --- |
| The handle isn't a payload in this conversation | `No such handle: <handle>` |
| The surface isn't registered, or its contract or implementation doesn't declare the query itself (an inherited name such as `toString` doesn't count) | `Unsupported query "<query>". Available: <the contract's query names, comma-separated, or none>.` |
| `args` (or `{}`) fails the query's schema | `Invalid args for "<query>": <message>` |
| The handler throws | `query_ui failed: <message>` |
| Otherwise | the `Capped` value's `text` |

A query on a surface that has since been revised answers from the payload the
model named, which is the one it asked about. Every answer but `query_ui
failed: …` then gets a line added: `(<handle> has since been revised: it is
<latest handle> now.)`.

`query_ui` looks up the payload by handle within the conversation. It doesn't
check that the handle is in the conversation's history, so a payload left
behind by an overtaken turn can still be queried.

### `SurfaceImpl`, `AnySurfaceImpl`

```ts
interface SurfaceImpl<P, A extends ActionMap, Q extends QueryMap> {
  readonly surface: Surface<P, A, Q>;
  readonly impl: SurfaceImplDef<P, A, Q>;
}

type AnySurfaceImpl = SurfaceImpl<any, ActionMap, QueryMap>;
```

What `implement` returns: what `createHai({ surfaces })`, `ctx.render`,
`ctx.update` and `hai.update` take. `AnySurfaceImpl` is the element type of
`HaiConfig.surfaces`.

### `DigestCtx`, `ActionCtx`, `QueryCtx`

```ts
interface DigestCtx {
  handle: string;
}

interface ActionCtx<P> {
  props: P;
  handle: string;
  readonly conversationId: string;
}

interface QueryCtx<P> {
  props: P;
  cap: Cap;
}
```

| Context | Field | Value |
| --- | --- | --- |
| `DigestCtx` | `handle` | The handle of the payload just stored, for the digest to mention so the model can query it |
| `ActionCtx` | `props` | The stored payload's props: the server's copy, never props from the browser. It's the stored JSON copy (see [Schemas](#schemas)) |
| | `handle` | The clicked surface's handle |
| | `conversationId` | The conversation's id |
| `QueryCtx` | `props` | The stored payload's props, the stored JSON copy |
| | `cap` | Makes the handler's return value, with the total already set (see [Query handlers](#query-handlers)) |

### How a click is handled

The browser posts `{ conversationId, handle, action, value }` to
`/interact`. The server loads the conversation, taking its lease:

- **If another request holds the lease,** the answer is HTTP 409 with
  `{ "error": "conversation <id> is busy — another turn is in flight" }`, and
  no event stream.
- **If the conversation doesn't exist,** or `conversationId` is missing, the
  store creates a new, empty one. The click is then refused with `unknown
  handle`, and the empty conversation stays stored.

Then it stores any update notice the conversation still owes (see
[Revisions](revisions.md#from-outside-a-turn-haiupdate)), and checks, in this
order. The first check that fails answers the request, and nothing is
recorded.

| Check | Answer |
| --- | --- |
| The conversation has expired | an `expired` event (see [Freshness](#freshness)) |
| `handle` isn't in the conversation's history | `error`: `unknown handle` |
| `handle` was revised | `error`: `superseded by <latest handle>` |
| `handle` is frozen | `error`: `component is frozen` |
| Its payload can't be read | `error`: `unknown handle` |
| Its surface isn't registered | `error`: `unknown component: <name>` |
| The contract or the implementation lacks `action` | `error`: `unbound action`. Only names each declares itself count, so one every object inherits, such as `toString`, is refused here too |
| `value` fails the action's schema | `error`: `invalid action payload: <message>` |
| A `resolve` on a surface the conversation isn't waiting on | `error`: `nothing awaiting this handle` |
| An `inform` while a question is waiting | `error`: `a question is waiting to be answered first` |
| The handler throws | `error`: `action failed: <message>` |

Once the handler returns its label, the click is recorded:

- **`resolve`**:
  1. The surface is frozen.
  2. A user message is recorded. It holds the results of any other tool calls
     from the parked reply, then the question's tool result, then any unread
     notices. The tool result is the question's held digest (see
     [`digest`](#digest)), a newline, and the label.
  3. The conversation goes back to `idle`.
- **`inform`**: a user message is recorded: any unread notices, then
  `[UI interaction] <label>`.

The click is saved before the model runs. Then the browser gets `ui_state`
(`frozen`, with `selection` set to the parsed value) for a `resolve`, and an
`interaction` block with the label. Then the turn runs.

If that save fails, the click is undone and the browser gets the error. The
user can simply click again. Apart from the 409, every answer above reaches
the browser on the response's event stream, with HTTP status 200. See
[HTTP routes and the wire](http.md).

## Freshness

### `staleAfterMs`

How long a surface's data may be acted on, in milliseconds counted from when
its payload was stored, or `"never"`, the default. Set it on any surface
showing prices, availability or anything else that changes.

**Refused at startup.** `createHai` throws a `RangeError` for a value that
isn't `"never"` or a positive, finite number:

```
surface <name>: staleAfterMs must be a positive, finite number of milliseconds, or "never" (got <value>)
```

That includes `0`, negative numbers, `NaN`, `Infinity` and `null`. A string
value is shown in quotes, such as `(got "soon")`. Leaving the field out is
the same as `"never"`.

**What a window does.** Once any surface in a conversation is past its window,
the conversation has expired. Every request on it, typed or clicked, is
refused before the model runs. The browser is sent:

```
This conversation is out of date — results shown <age> ago were only valid for <window>. Start a new conversation for current results.
```

`<age>` and `<window>` are written in the largest whole unit that fits: days,
hours, minutes or seconds, rounded down, such as `2 hours` or `1 minute`. A
duration under a second reads `under a second`.

**Exactly which surfaces count.**

- **Every handle in the history counts, answered ones too.** What the user
  picked from a surface is still in the model's context at the price it was
  shown at.
- **A revised surface doesn't count.** Its revision does, from when the
  revision was stored.
- **Each surface is held to the stricter of two windows.** One is the window
  recorded with its payload when it rendered. The other is the window its
  surface declares now. A later deploy can shorten a window, but renaming a
  surface, removing it, or lengthening its window never lets data already
  shown last longer.
- **A window that can't be known counts as expired.** That's a payload with
  no recorded window whose surface is no longer registered. The message then
  ends `… results shown <age> ago can no longer be checked. …`.
- **A payload that can't be read or dated counts as expired too.** If a
  payload the history refers to is missing, the message reads `… results
  shown here can no longer be checked. …`. Nothing deletes a payload the
  history still refers to, so a missing one is lost data, which can't prove
  anything is fresh. A payload whose `createdAt` isn't a finite number
  expires the same way, and the message reads `… results shown here were only
  valid for <window>. …`.
- **Which surface the message is about.** A missing payload takes
  precedence over everything. Otherwise the message is about the surface that
  went out of date first. A payload that can't be dated (no known window, or
  a bad `createdAt`) is reported only if it comes before every other expired
  surface in the history.

**When it's checked, and what happens.**

| Where | When expired |
| --- | --- |
| `/chat` and `/interact`, at the start (after any owed update notice is stored) | the `expired` event, and nothing is recorded |
| A wake turn, before it starts | no turn: `hai.wake` resolves to `"idle"`, and nothing is sent |
| `ctx.update` and `hai.update`, before the revision is stored | throws or rejects: `this conversation is out of date; nothing more can be revised in it` |
| `ctx.update` and `hai.update`, once the revision's digest is ready, against the revised surface's own window | throws or rejects: `this conversation went out of date while the revision was made; it was not applied` |

A revision can't bring an expired conversation back. An expired conversation
isn't closed to everything, though: `hai.notify` still stores notices for it,
and the events stream still delivers them. `/start` doesn't check, since it
does nothing once a conversation has begun.

The browser also counts each window, from `ui_open`'s `staleAfterMs` and
`ageMs`, so an open tab closes the conversation on time without waiting for
a refused request. Its own message reads `… results shown here were only
valid for <window>. …`. See [The browser client](client.md).

## Elicit mode in the types

### `HasResolve`

```ts
type HasResolve<A extends ActionMap> = [ResolveKeys<A>] extends [never] ? false : true;
```

`true` when `A` declares at least one `resolve` action. (`ResolveKeys` is
internal.)

### `ElicitOptions`

```ts
type ElicitOptions<A extends ActionMap> = HasResolve<A> extends true
  ? { mode: "elicit" }
  : {
      mode: "elicit";
      "⚠ this surface declares no resolve action — an elicit turn could never be unparked": never;
    };
```

The options type of `ctx.render`'s elicit overload. For a surface with no
`resolve` action, the type has a required property that nothing can satisfy,
so the compiler's error names the actual problem rather than saying a type
isn't assignable to `never`.

## When the types are bypassed

Code the type checker doesn't see, such as plain JavaScript or a value cast
to `any`, can get past the types' rules. Here's what the server does then:

| Mistake | What happens |
| --- | --- |
| An implementation with no `digest` | Rendering it fails with a `TypeError` after the payload is stored. The handle never joins the history, and the model hears `<tool> failed: <message>` |
| A `digest` that's async, or returns something other than a string | Rendering fails with a `TypeError`, `surface <name>: digest must return a string (got <type>)`, after the payload is stored, as for a digest that throws. A promise's rejection is caught, not left unhandled |
| A query handler that returns a plain object | `query_ui` returns its `text` field, uncapped. Nothing checks that a `Cap` made it |
| A query handler that's async | Nothing awaits it: `query_ui` reads `text` from the promise, finds none, and the model gets `query_ui returned no result.`. One that rejects is an unhandled rejection |
| An action handler that returns something other than a string | It's recorded as it is, in `[UI interaction] <label>` or after the digest |
| `mode: "elicit"` on a surface with no `resolve` action | The turn parks on it. No click can answer it, so the conversation stays parked until the user types a message, which closes the question out |
| `ctx.render` with a `mode` other than `"display"` or `"elicit"` | A missing, `undefined` or `null` mode is `"display"`. Anything else is treated as `"elicit"` |
| An action spec whose `kind` is neither `"resolve"` nor `"inform"`, such as `"Resolve"`, or that has no `input` schema | Refused at startup: `createHai` throws a `TypeError`, `surface <name>: action "<action>" has kind "<kind>"; declare it with resolve() or inform()`, or `surface <name>: action "<action>" has no input schema with a parse method` |

The fourth guarantee, that only declared actions reach the server, holds at
runtime: the server refuses any action the contract and the implementation
don't both have. Its refusal messages are in
[How a click is handled](#how-a-click-is-handled).
