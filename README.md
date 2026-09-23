# haikit

A framework for LLM tools that return **interactive UI** alongside a token-cheap digest.

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

One tool execution produces two outputs. A flight search fetches 47 rows: the
model receives a sentence, the browser receives the rows. The user clicks one,
and that click becomes the model's answer — **97% of the payload never enters
context.**

## Quick start

```bash
npm install
npm run example:hello      # or example:flights — no API key needed
```

Then http://localhost:5175. Watch the right-hand pane: it shows everything the
model actually receives.

To build your own, follow the tutorial, or read `examples/hello` — it is about
150 lines.

## Packages

| | |
|---|---|
| [`@haikit/core`](packages/core) | contracts, `Capped`, wire types, adapter interfaces. Isomorphic, zero deps |
| [`@haikit/server`](packages/server) | agent loop, elicit state machine, derived `query_ui`, routes |
| [`@haikit/client`](packages/client) | browser runtime + default UI. Plain ESM, no build step |
| [`@haikit/anthropic`](packages/anthropic) | Claude model adapter |

Adapters depend on `@haikit/core` only — never on the runtime. That is what keeps
the model and store seams swappable.

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

**The contract split.** A surface is declared once and implemented twice — once
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

## Development

```bash
npm run build       # compile packages
npm run typecheck   # packages + examples, server code and browser components
npm run typetest    # the four guarantees, as real compile errors
npm run smoke       # boots both examples, drives the elicit loop end to end
npm test            # all three
```

`typetest` compiles `packages/core/test/types/guarantees.ts` twice — once with
its `@ts-expect-error` directives (must be clean, so none can go stale) and once
with them stripped (every marked line must error). The guarantees are verified,
not asserted in prose.

## Status

Working, and honest about what isn't done.

- **`memoryStore()` is development-only.** A parked elicit turn is durable
  state; lose `pending` and that conversation can never be sent again. A
  Postgres store implements the same four-method interface.
- **Turn leases are recorded but not reclaimed.** A process dying mid-turn
  leaves a lease in the past; nothing sweeps it yet.
- **No `ui_patch`.** The model cannot mutate a live surface in place, so a
  refresh re-renders and loses scroll and sort state.
- **Payload staleness is undefined.** A picker parked for a week resolves
  against data that may be gone.
- **No approval gates** — though they are structurally identical to elicit with
  a two-button surface.
- **No MCP export.** Tools would degrade gracefully (the digest is a complete
  text answer); elicit tools would have to be excluded.

## Licence

MIT
