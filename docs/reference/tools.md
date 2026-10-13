# Tools

A tool is a function the model can call. Through its context, it can show
surfaces, revise them, and report progress. HaiKIT adds one tool of its own,
`query_ui`, which answers the model's questions about stored payloads.

Everything on this page is exported by `@haikit/core`. The behaviour
described comes from `@haikit/server`, which runs the tools.

Checked against `@haikit/*` 0.20.0. Source: `packages/core/src/index.ts` and
`packages/server/src/runtime.ts`.

- [Declaring a tool](#declaring-a-tool): `defineTool`, `Tool`, `JsonSchema`
- [How a tool call runs](#how-a-tool-call-runs)
- [The tool's context](#the-tools-context): `ToolCtx`, `ToolReturn`,
  `Progress`
- [The built-in `query_ui` tool](#the-built-in-query_ui-tool)
- [Capping](#capping): `makeCap`, `Cap`, `CapOptions`, `Capped`
- [`estTokens`](#esttokens)

## Declaring a tool

### `defineTool`

```ts
function defineTool<I>(def: {
  name: string;
  description: string;
  input: Schema<I>;
  inputJsonSchema: JsonSchema;
  strict?: boolean;
  run(input: I, ctx: ToolCtx): Promise<ToolReturn> | ToolReturn;
}): Tool<I>;
```

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | required | The name the model calls it by |
| `description` | `string` | required | Sent to the model with the tool |
| `input` | `Schema<I>` | required | Validates the model's input before `run` |
| `inputJsonSchema` | `JsonSchema` | required | Sent to the model as the tool's `input_schema`. HaiKIT can't derive it from `input`: write it, or generate it (for example with zod's JSON Schema export) |
| `strict` | `boolean` | `true` | Sent to the model with the tool, asking it to keep its input to the schema exactly. See [Models](models.md) for what the adapter does with it |
| `run` | `(input, ctx) => ToolReturn \| Promise<ToolReturn>` | required | Does the work. See [How a tool call runs](#how-a-tool-call-runs) |

**Returns** `{ strict: true, ...def }`. An explicit `strict: undefined` in
`def` overrides the default, leaving `strict` undefined.

**Registration.** List tools in `createHai({ tools })`. The model is offered
them in this order:

1. your tools, in the order listed;
2. `query_ui`;
3. the init tool, if `HaiConfig.init` is set, with a note appended to its
   description (see [The server](server.md#init)).

Two tools with the same name don't make `createHai` throw: the later one
replaces the earlier, in the earlier one's place in the order. A tool of yours
named `query_ui` is replaced by the built-in one, in your tool's place. An
init tool sharing a name with any other tool makes `createHai` throw: `init
tool "<name>" has the same name as another tool`. That includes `query_ui`,
and the init tool itself listed in `tools`.

### `Tool<I>`

```ts
interface Tool<I = any> {
  readonly name: string;
  readonly description: string;
  readonly input: Schema<I>;
  readonly inputJsonSchema: JsonSchema;
  readonly strict: boolean;
  run(input: I, ctx: ToolCtx): Promise<ToolReturn> | ToolReturn;
}
```

What `defineTool` returns, and the element type of `HaiConfig.tools`.

### `JsonSchema`

```ts
type JsonSchema = Record<string, unknown>;
```

A JSON Schema object. HaiKIT doesn't read or check one. A tool's
`inputJsonSchema` is passed to the model as it is. A query's `argsJsonSchema`
is written into `query_ui`'s description, as JSON text.

## How a tool call runs

When a model reply asks for tools, the server runs its calls **one at a time,
in the order the reply lists them**. For each call, the browser first gets a
`tool` block with status `running`. Then:

1. **The tool is looked up by name.** If there's no such tool, the result is
   `Unknown tool: <name>`. If the model called the init tool, which already
   ran, the result is `<name> already ran at the start of this conversation;
   its result is above.`.
2. **The input is validated** with the tool's `input` schema. On failure the
   result is `Invalid input for <name>: <message>`, and `run` isn't called.
3. **`run` is called** with the validated input and a fresh `ToolCtx`.
4. **Renders it started are awaited.** Any `ctx.render` or `ctx.update` still
   in flight when `run` returns or throws, one it didn't await, finishes
   before the call is decided. One that fails is ignored, unless it lost the
   lease: the call is decided by what `run` did. From the moment `run`
   returns or throws, a further `render`, `update` or `progress` does nothing
   (see [`ToolCtx`](#toolctx)).
5. **The call is decided:**

| Outcome | Tool result | Browser: the `tool` row |
| --- | --- | --- |
| No such tool, the init tool again, or invalid input (steps 1 and 2) | the message given there | `ok`, with that message as its result |
| `run` returned | the returned `model` | `ok`, with the time taken and `model` as its result |
| `run` returned, having shown a question | held: see below | `awaiting`, with the held text as its result |
| `run` threw | `<name> failed: <message>` | `ok`, with that message as its result |
| `run` threw, having shown a question | `<name> failed: <message>` | `ok`, with that message. The question is withdrawn: frozen, the browser told with `ui_state`, and a later call in the reply may ask instead |
| The lease was lost (`StaleLease`) | none: the turn stops | no final status. An `error` event, and nothing more is saved |

A failed tool is information for the model: its message becomes the tool
result, and the turn goes on. A lost lease isn't. It means another request
took the conversation over, so the turn stops rather than paying for model
calls whose results can't be saved. Any `render` or `update` the call started
that fails with `StaleLease` stops it, whether the tool awaited it, caught
it, or neither. So does any error named `StaleLease` that `run` throws.

**A call that showed a question.** When a call rendered an elicit surface,
the reply's tool results aren't sent back yet. The conversation parks on the
question (status `awaiting`). The reply's other calls still run, before and
after it, and their results are kept to send with the answer. The text held
for the question is the surface's digest. If `run` returned `model` text
other than exactly that digest, the text follows it, on its own line, so the
model still hears it. That's how the model learns of a second question it
wasn't allowed to ask, for instance. So for an elicit render, return its
result unchanged, or only the extra text: the digest is put first anyway.

On a turn's last hop, the `maxHops`th model call, the reply's calls still
run and their results are recorded, but the turn then ends without a model
reply to them (see [The server](server.md#maxhops)).

When the user answers, the question's tool result is the held text, a
newline, and the `resolve` handler's label. When the user types instead, it's
the held text, a newline, and `User did not select; they said: "<text>"`.
See [Surfaces: how a click is handled](surfaces.md#how-a-click-is-handled).

**A `run` that doesn't keep to the types.** JavaScript code can get these
wrong:

- If `run` returns anything without a string `model` (nothing, `null`, a
  bare string), the result is `<name> returned no result.`, and the turn goes
  on. If the call showed a question, the question's digest is the result
  instead, as if `run` had returned `render`'s result.
- If it throws something that isn't an `Error`, such as a string or
  `undefined`, the result is `<name> failed: <that value as text>`, such as
  `lookup failed: undefined`. A value that can't be made into text, such as
  an object with no prototype, reads `an error that can't be shown as text`.

Either way, the call gets a result, so the history stays one the model API
accepts.

## The tool's context

### `ToolCtx`

```ts
interface ToolCtx {
  readonly conversationId: string;
  text(model: string): ToolReturn;
  progress(progress: Progress): void;
  render<P, A, Q>(surface: SurfaceImpl<P, A, Q>, props: P, options: ElicitOptions<A>): Promise<ToolReturn>;
  render<P, A, Q>(surface: SurfaceImpl<P, A, Q>, props: P, options?: { mode?: "display" }): Promise<ToolReturn>;
  update<P, A, Q>(surface: SurfaceImpl<P, A, Q>, handle: string, props: P): Promise<ToolReturn>;
}
```

(`A extends ActionMap, Q extends QueryMap` on every method; shortened here.)

A new context is made for each call. Once `run` has returned or thrown,
`render` resolves to `{ model: "Not shown: the tool had already finished." }`
without doing anything, `update` to `{ model: "Not revised: the tool had
already finished." }`, and `progress` does nothing.

#### `conversationId`

The conversation the call runs in. Keep it if the tool starts work that ends
later and should tell the conversation, with `hai.notify` or `hai.update`.

Don't await `hai.update` on this conversation inside the call. The running
turn holds the lease, so it waits its `timeoutMs` (30,000 ms by default) and
rejects with `ConversationBusy`. Use `ctx.update` instead. A notice sent with
`hai.notify` during the turn isn't heard in that turn either. It rides the
next message recorded for the user's side (see
[Notices](notices.md#what-the-model-hears)).

#### `text`

```ts
text(model: string): ToolReturn;
```

Returns `{ model }`: a result with no surface.

#### `render`

```ts
render(surface, props, options?): Promise<ToolReturn>;
```

Shows a surface. `options.mode` is `"display"` (the default) or `"elicit"`.

1. `props` is validated with the surface's `props` schema. If it fails, the
   error is thrown here, and nothing is stored. (For an elicit render, the
   one-question check below comes first.)
2. The payload is stored, which gives the surface its handle. The store
   presents the conversation's fencing token, and a lost lease throws
   `StaleLease`.
3. The implementation's `digest` is called with the validated props and the
   handle. If it throws, the payload stays stored, but the handle never joins
   the history and nothing is sent.
4. The handle joins the conversation's history. The browser gets `ui_open`,
   then `ui_props` with the validated props. `ui_open` carries the handle,
   the id of the call's `tool` block, the surface's name and version, the
   mode, the freshness window if it has one, and `ageMs`: how long since the
   server began storing the payload.
5. It resolves to `{ model: <digest>, handle }`.

**Display** surfaces resolve as soon as they're shown. Return the result as
it is, or add to its `model` text.

**Elicit** surfaces make this call the question the turn waits on (see
[How a tool call runs](#how-a-tool-call-runs)). One model reply asks one
question at most:

- A second elicit render in the same reply, from this call or another, isn't
  stored or shown. It resolves to `{ model: "Not shown: <handle> is already
  waiting for the user. Ask this again after it is answered." }`, with no
  `handle`.
- Two renders started at once can't both ask. The first to start claims the
  question. One still being stored is waited for, and if it fails, the next
  may ask instead.

`render` doesn't check that the surface is registered. A surface that isn't
can be shown, but it can't be clicked or queried.

#### `update`

```ts
update(surface, handle, props): Promise<ToolReturn>;
```

Revises a surface this conversation shows, in place, and resolves to
`{ model: <new digest>, handle: <new handle> }`. Among other checks, it throws
if `handle` isn't in this conversation, was answered or withdrawn, was revised
already, is being revised by another call, or is a different surface, or if
the conversation has expired. See
[Revisions](revisions.md#inside-a-tool-ctxupdate) for every check and
message.

#### `progress`

```ts
progress(progress: Progress): void;
```

Tells the browser how far the call has got, with a `progress` event. Nothing
is stored, and the model never sees it. In a wake turn, progress also goes to
other servers' streams, and is replayed, merged, to a stream that joins part
way (see [HTTP routes and the wire](http.md#wake-turns-on-the-stream)).

- **Each call names only the fields it changes.** Say what's happening once,
  then count.
- **Fields that aren't what their type says are dropped, not thrown on.**
  `message` must be a string, `done` a finite number of 0 or more, and `total`
  a finite number above 0. A call with no valid field does nothing. So a
  field can't be cleared once sent: `undefined` is dropped.
- **Frames are throttled.** The first goes out at once. After that, one goes
  at most every 100 ms, carrying every field named since the last. Whatever
  is still waiting when the tool returns goes out before the row is updated.
- Once `run` has returned or thrown, `progress` does nothing.
- The default UI shows progress only while the row's status is `running`.

### `ToolReturn`

```ts
interface ToolReturn {
  model: string;
  handle?: string;
}
```

| Field | Meaning |
| --- | --- |
| `model` | The tool result: everything the model receives from this call |
| `handle` | Set by `render` and `update` on the handle they showed. A tool may pass it on, but the runtime decides which surface a call asked about from what it rendered, not from this field |

### `Progress`

```ts
interface Progress {
  message?: string;
  done?: number;
  total?: number;
}
```

| Field | Meaning |
| --- | --- |
| `message` | What the tool is doing now, for a person to read |
| `done` | Steps finished so far |
| `total` | Steps in all, when the tool knows. With it, the default UI draws a progress bar |

## The built-in `query_ui` tool

Every app has `query_ui`. HaiKIT builds it from the registered surfaces' query
declarations when `createHai` runs, so it can't drift from them. It's in the
model's tool list even when no surface declares a query.

**What the model sees.**

- **Description:** `Dereference a rendered component's full dataset. The
  digest in your context holds only highlights; use this for anything beyond
  it. Never guess about rows you have not seen.`, then a space. When any
  surface declares queries, a blank line follows, then `Available queries:`,
  then one line per query:

  ```
  - <surface>.<query> — <description> args: <argsJsonSchema as JSON>
  ```

  The `— <description>` part appears only when the query has a description.
  A query with no `argsJsonSchema` ends `args: (undeclared — omit them)`.
- **Input schema:**

  ```json
  {
    "type": "object",
    "properties": {
      "handle": { "type": "string", "description": "e.g. ui_01" },
      "query": { "type": "string", "description": "One of the query names listed in the description." },
      "args": {
        "type": "object",
        "description": "Arguments for the chosen query, matching that query's schema in the description. Pass the constraints the user actually asked for — omitting them matches everything."
      }
    },
    "required": ["handle", "query"]
  }
  ```

- **`strict`:** `false`.

HaiKIT doesn't validate its input at all, and with `strict: false` the model
API isn't asked to either: the model's input reaches the lookup as it is. A
missing `handle` gets `No such handle: undefined`, and input that isn't an
object gets `query_ui failed: <message>`. For each answer it can give, see
[Surfaces: query handlers](surfaces.md#query-handlers).

## Capping

### `makeCap`

```ts
function makeCap(total: number): Cap;
```

Returns a `cap` function that reports against `total`, the size of the whole
collection. The runtime makes one for each query and hands it to the handler
as `ctx.cap`, with `total` set to the length of the payload's first array
prop, or 0 with none (see [Surfaces: query handlers](surfaces.md#query-handlers)).
You only need `makeCap` to test a query handler outside the runtime.

### `Cap`, `CapOptions`

```ts
type Cap = <T>(rows: T[], fmt: (row: T) => string, opts?: CapOptions) => Capped;

interface CapOptions {
  maxRows?: number;   // default 8
  maxChars?: number;  // default 1800
}
```

`cap(rows, fmt, opts)` takes the rows that matched, formats them, and keeps as
many as fit:

1. It takes the first `maxRows` rows.
2. It formats each with `fmt` in turn, and keeps lines while the kept lines,
   joined by newlines, stay within `maxChars`. It stops at the first line
   that doesn't fit. Whichever bound binds first wins. The first line, below,
   isn't counted, so `text` can be up to its length plus 1 plus `maxChars`.
3. It writes a first line:
   - with no rows: `0 of <total> match.`
   - otherwise: `<rows> of <total> match. <shown> shown:`, or
     `<rows> of <total> match. <shown> shown, <omitted> omitted:` when some
     were left out, where `<omitted>` is the rows passed in minus the rows
     shown.
4. The text is the first line, then the kept lines, one per line. With no
   lines kept, it's the first line alone. That can end `0 shown, <n>
   omitted:` when even the first row's line is longer than `maxChars`.

`maxRows` and `maxChars` aren't validated. A `maxRows` of 0 shows nothing, and
a negative one drops rows from the end (`Array.prototype.slice`).

For example, ``cap(matches, (f) => `${f.id} $${f.price}`)`` with 30 matches
out of 47 flights gives:

```
30 of 47 match. 8 shown, 22 omitted:
AC832 $343
…
```

### `Capped`

```ts
interface Capped {
  readonly [CAPPED]: true;
  text: string;
  shown: number;
  total: number;
}
```

| Field | Meaning |
| --- | --- |
| `text` | What the model receives: the first line and the kept rows |
| `shown` | How many rows were kept |
| `total` | The `total` given to `makeCap` |

`CAPPED` is a symbol declared only in the types, with no value at runtime. No
object literal can have the property, so the type checker accepts only what
`cap` returns. This is what makes a query handler cap its answer. JavaScript
code isn't held to it (see
[Surfaces: when the types are bypassed](surfaces.md#when-the-types-are-bypassed)).

## `estTokens`

```ts
const estTokens: (value: unknown) => number;
```

A rough token count: the length of `value` (a string as it is, anything else
as `JSON.stringify(value ?? "")`) divided by 4, rounded up. It throws a
`TypeError` for a value `JSON.stringify` can't measure: a `BigInt` or a
cycle, or a top-level function or symbol, for which `JSON.stringify` returns
`undefined`. The runtime uses
it for the `context` event's `modelTokens` (the whole history) and `uiTokens`
(the sum over the conversation's payloads' props), which the default UI's
inspector shows. Nothing else depends on it.
