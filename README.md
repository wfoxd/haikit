<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/haikit-logo/haikit-logo-reversed.svg">
    <img src="docs/haikit-logo/haikit-logo.svg" alt="HaiKIT" width="280">
  </picture>
</h1>

<p align="center"><strong>Build whole apps with an LLM, not just chats that call one.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/search?q=haikit"><img src="https://img.shields.io/npm/v/@haikit/core?label=%40haikit&color=0f1115" alt="npm version"></a>
  <a href="https://github.com/wfoxd/haikit/actions/workflows/ci.yml"><img src="https://github.com/wfoxd/haikit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-0f1115" alt="MIT licence"></a>
</p>

<p align="center">
  <a href="https://haikit.app"><strong>Try it live</strong></a> ·
  <a href="docs/tutorial.md">Tutorial</a> ·
  <a href="docs/tutorial-2.md">Notifications tutorial</a> ·
  <a href="docs/spec.md">Design spec</a> ·
  <a href="docs/default-ui.md">Default UI</a>
</p>

HaiKIT is a TypeScript framework for LLM tools that answer with **interactive
UI** as well as text. Each tool result goes two ways: the model gets a short
digest, and the browser gets the full data as a component. A click on that
component can be the answer to the model's question.

```
                    ┌─ model channel ──▶ tool_result (digest) ──▶ Claude
tool executes ──────┤
                    └─ UI channel ─────▶ SSE ──▶ registry ──▶ rendered component
                                                      ▲
                                  user interacts ─────┘
                                        │
                                        ▼
                            back into the turn as a tool_result
```

A flight search fetches 47 rows: the model receives a sentence, the browser
receives the rows. The user clicks one, and that click becomes the model's
answer. **97% of the payload never enters context.**

## Try it

- **Live:** [haikit.app](https://haikit.app) is HaiKIT's introduction, built
  with HaiKIT: what an elicitation app is and how HaiKIT builds one, in short
  lessons, with the tutorial built in. Its source is [`apps/intro`](apps/intro),
  a standalone app you can run or deploy yourself.
- **Locally:** the examples run with no API key, on a scripted model that
  sees exactly what Claude would. Node 22.18 or later.

  ```bash
  npm install
  npm run example:hello      # http://localhost:5175
  ```

  `npm run example:flights` (http://localhost:5173) is the flight search above,
  and `npm run example:hello-react` (http://localhost:5176) is hello with React
  components. Open **Context**, top right: the model context drawer shows
  everything the model actually receives.

## Use it in your app

```bash
npm install @haikit/core @haikit/server @haikit/client @haikit/anthropic zod
```

Declare a surface once, then implement it on the server: what the model reads,
and what a click means.

```ts
const picker = defineSurface({
  name: "greeting_picker",
  version: 1,
  props: z.object({ greetings: z.array(Greeting) }),
  actions: { choose: resolve(z.string()) }, // a click answers the question
});

const pickerServer = picker.implement({
  digest: (props, { handle }) => `${props.greetings.length} greetings, shown as ${handle}.`,
  actions: { choose: (code) => `The user chose ${code}.` },
  queries: {},
});
```

A tool renders it. In `elicit` mode the turn parks until the user clicks:

```ts
const listGreetings = defineTool({
  name: "list_greetings",
  description: "Show the greeting picker and wait for the user's choice.",
  input: z.object({}),
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  run: (_input, ctx) => ctx.render(pickerServer, { greetings: GREETINGS }, { mode: "elicit" }),
});

const hai = createHai({
  model: anthropic(), // claude-haiku-5-5 unless you pass another model
  store: memoryStore(), // @haikit/postgres in production
  tools: [listGreetings],
  surfaces: [pickerServer],
  system: "Greet people in the language they pick.",
});
const handle = nodeHandler(hai, "/hai"); // /hai/start, /hai/chat, /hai/interact
```

In the browser, `mountChat` from `@haikit/client/app.js` draws the chat, and a
registry entry draws the surface; its click handler calls
`ctx.send("choose", code)`. [The tutorial](docs/tutorial.md) builds this app
end to end in ten steps, and [`examples/hello`](examples/hello) is the
finished result, about 150 lines.

## Packages

| Package | What it is |
| --- | --- |
| [`@haikit/core`](packages/core) | Contracts, `Capped`, wire types, adapter interfaces. Isomorphic, zero dependencies |
| [`@haikit/server`](packages/server) | Agent loop, elicit state machine, derived `query_ui`, HTTP routes |
| [`@haikit/client`](packages/client) | Browser runtime and the [default UI](docs/default-ui.md). Plain ESM, no build step |
| [`@haikit/anthropic`](packages/anthropic) | Claude model adapter. Defaults to `claude-haiku-5-5` |
| [`@haikit/postgres`](packages/postgres) | Durable store adapter. Bring your own driver |
| [`@haikit/react`](packages/react) | Write surface components in React, typed from the surface contract |

Adapters depend on `@haikit/core` only, never on the runtime. That is what
keeps the model and store seams swappable.

## The idea in three parts

**The dual channel.** `ctx.render(surface, props)` stores the payload, runs your
`digest`, streams the props to the browser, and returns the digest as the
`tool_result`. The model holds a handle and a summary; the browser holds the
data.

**Elicit mode.** A tool can emit a `tool_use` and deliberately send *no*
`tool_result`. The conversation parks; the HTTP response closes. When the user
clicks, that click becomes the tool result and the same turn resumes. The model
cannot distinguish a tool that took 200ms from one that waited three days on a
human. *The component is the question.*

**The contract split.** A surface is declared once and implemented twice: once
on the server (digest, action handlers, query accessors) and once in the browser
(the component). Change a prop and both halves fail typecheck.

## What the framework refuses to let you build

Each row is a bug the prototype this was extracted from actually produced.

| Failure mode | Prevented by |
| --- | --- |
| Model narrates facts about rows it never received | `digest` is a required field |
| A filter matches everything and dumps the payload into context | Query return type only constructible via `cap()` |
| Injected content wires a button to `delete_account` | Browser sends `{handle, action, value}`; it cannot name a target |
| An undeclared element quietly round-trips | Undeclared = local by construction; the contract *is* the allowlist |
| A blocking tool with no way to unblock | `mode: "elicit"` only compiles on a surface declaring `resolve` |

## Documentation

| | |
| --- | --- |
| [Tutorial](docs/tutorial.md) | Build *Hello, World!* as a HaiKIT app in ten steps, annotated line by line |
| [Tutorial 2: Tell them later](docs/tutorial-2.md) | Teach the same app to speak up after the request is over: progress, notices, wake turns and live updates |
| [Design spec](docs/spec.md) | The dual channel, the contract split, elicit mode, the four guarantees, package topology |
| [Default UI](docs/default-ui.md) | The chat UI `@haikit/client` ships: setup, the model context drawer, theming, styling your surfaces |
| [The introduction](apps/intro) | HaiKIT's introduction as a deployable app, live at [haikit.app](https://haikit.app) |

## Development

```bash
npm run build       # compile packages
npm run typecheck   # packages + examples, server code and browser components
npm run typetest    # the four guarantees, as real compile errors
npm run storetest   # the StoreAdapter rules, against the memory store
npm run reacttest   # @haikit/react against React and a DOM
npm run pgtest      # @haikit/postgres; set HAIKIT_PG_URL for a real server too
npm run smoke       # boots every example, drives the elicit loop end to end
npm test            # all of the above
```

`typetest` compiles `packages/core/test/types/guarantees.ts` twice: once with
its `@ts-expect-error` directives (must be clean, so none can go stale) and once
with them stripped (every marked line must error). The guarantees are verified,
not asserted in prose.

`apps/intro` has its own `npm test`, and its own CI job that also checks it
daily against the newest HaiKIT release.

## Status

Working, and honest about what isn't done.

- **`memoryStore()` is development-only.** A parked elicit turn is durable
  state; lose `pending` and that conversation can never be sent again. Ship
  with [`@haikit/postgres`](packages/postgres), or implement the five-method
  `StoreAdapter` for your own database.
- **No approval gates**, though they are structurally identical to elicit with
  a two-button surface.
- **No MCP export.** Tools would degrade gracefully (the digest is a complete
  text answer); elicit tools would have to be excluded.

## Licence

[MIT](LICENSE)
