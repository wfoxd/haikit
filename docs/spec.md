# haikit — design spec

> A framework for LLM tools that return interactive UI alongside a token-cheap digest. One tool execution produces two outputs: a digest for the model, a payload for the browser.

## A framework for tools that return *interface*, not just text.

One tool execution produces two outputs: a short digest for the model, and a full payload for the browser. The transcript renders the payload as an interactive component, and what the user does with it flows back into the turn.

## The dual channel

A tool that searches flights fetches all 47 of them. The model receives a sentence. The browser receives the rows.

```
            search_flights() → 47 records
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
   MODEL CHANNEL             UI CHANNEL
   66 tok                    2,181 tok
   digest + handle ui_01     full props over SSE
   enters messages[],        never enters context,
   billed every turn         never billed

   97% of the payload stays out of context — measured, not estimated
```

### The digest is the hard part

A count and a price range is a *lazy* digest. It invites the model to narrate facts it never received — “that's the cheapest nonstop” about rows it has never seen. The digest must precompute whatever the next turn or two will plausibly need:

```
"47 flights SFO→NRT, $202–$829. Cheapest: NH111 $202 (2 stops).
 Cheapest nonstop: AC832 $343, 08:38, 11h23m. Fastest: JL897 10h33m.
 11 nonstop / 36 with stops. Rendered as ui_01."
```

Sixty tokens instead of thirty, and every downstream claim is grounded. Anything past that is fetched on demand — the handle is a pointer, and `query_ui` is the dereference.

> **Always cap the dereference.** A filter that matches all 47 rows and returns all 47 defeats the entire design. In `haikit` a query's return type can only be constructed by calling `cap()` — forgetting it is a compile error, not a billing surprise.

## One declaration, two implementations

A React component can't be imported server-side, so a surface is declared once as a contract and implemented twice. TypeScript holds both halves to it, and the contract module is the only file both sides import.

```
// shared/surfaces/flight-table.ts — isomorphic, no React, no handlers
export const flightTable = defineSurface({
  name: "flight_table",
  version: 1,
  props: z.object({ origin: z.string(), flights: z.array(Flight) }),

  // Declaring an action is the ONLY way to make it round-trip.
  // Anything undeclared is component-local by construction.
  actions: { select: { kind: "resolve", input: z.string() } },
  queries: { filter: { input: FilterArgs }, cheapest: { input: CheapArgs } },
});
```

```
            shared/surfaces.ts   ◀── THE CONTRACT
            props schema · action names · query names · version
                      │
      .implement({…}) ┴ .component(…)
            ┌─────────────────────┐
            ▼                     ▼
server/surfaces.ts          client/FlightTable.tsx
digest()      REQUIRED      props    typed from contract
actions       handlers      actions  typed from contract
queries       → Capped      local state (undeclared)
never reaches the browser   ↳ never round-trips
```

### Tools do the split in one call

```
export const searchFlights = defineTool({
  name: "search_flights",
  input: z.object({ origin: z.string(), destination: z.string() }),
  strict: true,

  async run(input, ctx) {
    const flights = await inventory.search(input);
    return ctx.render(flightTableServer, { ...input, flights },
                      { mode: "elicit" });
  },
});
```

`ctx.render` allocates the handle, runs `digest`, persists the payload, emits the UI events, and returns the `tool_result`. The tool author never hand-writes the split — which is exactly why they can't get it wrong.

## Elicit mode: the user is a tool implementation

The model calls a tool and a human click produces the result. From the model's side nothing unusual happened — a tool took a while to return.

The Messages API is stateless and has no opinion about how long you take. There is no session and no open connection to hold. So the server emits the `tool_use`, renders a component, sends *no* `tool_result`, and closes the response. The conversation parks. When the user clicks, that click becomes the tool result and the same turn resumes.

```
 BROWSER                          SERVER
 ───────                          ──────
 send("find flights")  ──────────▶ load conversation · acquire lease
                                   model.stream() → tool_use
                                   ctx.render(surface, elicit)
 ui_open · ui_props    ◀────────── full payload — UI channel only
 <FlightTable live/>        ■      no tool_result · status = awaiting
 connection closed          ⋮      minutes · hours · days
 user clicks row AC832 ──────────▶ {surface, action, value}
                                   tool_result = digest + selection
 text_delta …          ◀────────── resume the same turn
```

### Why not just ask in prose

Without it, asking means flattening 47 rows into “here are the top five,” burning tokens on options, and then parsing *“the second one”* out of free text against rows the model half-remembers. With it, the options stay structured, the answer is a validated row id, and the turn never ended.

The framing that matters: **the component is the question.** The model doesn't ask “which one?” — the picker asking *is* the asking.

### Four things the parked turn must remember

| Field | Why it's a bug if you drop it |
| --- | --- |
| toolUseId | Which `tool_use` the click answers |
| handle | Which component's click counts — not just any click |
| digest | An elicit tool never got a `tool_result`, so its digest hasn't reached the model *at all* yet |
| results | Sibling tool results from the same turn — the API is all-or-nothing per batch |

> While parked, `messages[]` ends with an unanswered `tool_use` and is *invalid to resend*. `status = "awaiting"` is the only state where that shape is legal. Everything hard about elicit mode — reload, crash recovery, the user typing instead of clicking — follows from that one fact.

An approval gate is the same machinery with a two-button surface: park a turn, await a binary human answer, resume. Build elicit first and permissions become a surface definition.

## What the framework refuses to let you build

Every item below is a bug the prototype actually produced. A framework earns its keep by making them unrepresentable rather than documented.

| Failure mode | Prevented by |
| --- | --- |
| Model narrates facts about rows it never received | `digest` is a required field on every surface. No digest, no surface. |
| A filter matches everything and dumps the payload into context | A query's return type is only constructible via `cap()`. |
| Injected content renders a button wired to `delete_account` | The browser sends `{surface, action, value}`. It cannot name a target. |
| An undeclared element quietly round-trips | Undeclared means local, by construction. The declaration list *is* the allowlist. |
| A blocking tool with no way to unblock | `mode: "elicit"` only compiles on a surface declaring a `resolve` action. |
| Binding closures can't be persisted | Handlers live in the surface impl; the store holds only descriptors. |
| A deploy mid-turn strands the conversation forever | Heartbeated turn leases; expiry triggers rollback to the last committed boundary. |
| Shipping a component bricks week-old conversations | Surfaces carry a `version`; mismatches render a placeholder, not a crash. |

## Six packages

Core is isomorphic and depends only on Zod, because both halves import it. Adapters implement interfaces declared in core and never import the runtime, which is what keeps them swappable.

```
                  @haikit/core
            isomorphic · zero deps
   defineSurface() · defineTool() · Capped
   wire events · ModelAdapter · StoreAdapter
        ▲            ▲              ▲
        │            │              │
@haikit/server  @haikit/client   adapters
agent loop      createChat()     @haikit/anthropic
state machine   mountChat()      @haikit/store-pg
turn leases     renderTranscript
routes + SSE
handle store

@haikit/client must never import @haikit/server —
the only thing crossing that line is your contract module.
```

### What crosses each boundary

| Boundary | Crosses | Never crosses |
| --- | --- | --- |
| server → model | messages, digests, capped results | payloads, props, handlers |
| server → browser | blocks, wire events, full props | binding table, handlers, tool names |
| browser → server | {surface, action, value} | any action target or handler ref |
| shared contract | schemas, action + query names | implementations of either half |
| server → MCP host | tool defs, digests, query_ui | components, elicit tools, payloads |

Read rows two and three together — that pair is the injection defense. The browser gets everything it needs to *render* and nothing that lets it *name what happens next*.

Exported over MCP, tools degrade gracefully: a host without the registry gets the digest, which was always a complete text answer. Only elicit tools are excluded, because there's nothing to click.

## Where this actually stands

- Built Working prototype — dual channel, elicit park/resume, `query_ui` with caps, server-side binding table. Verified end to end in a browser.
- Built Three security rejections confirmed: unbound element, forged handle, frozen component.
- Spec `defineSurface` / `defineTool` with the `Capped` and elicit-requires-resolve type machinery.
- Spec Postgres store, turn leases, the append-only commit invariant, surface versioning.
- Open `ui_patch` for in-place mutation — patching preserves scroll and sort state; re-rendering destroys it.
- Open Payload staleness. A picker parked for a week shows sold-out flights at last week's prices.
- Open Consuming third-party MCP servers. Their results are single-channel, so a projection layer is needed or the context budget goes with it.

> **Deliberately refused:** a `render_ui(component, props)` tool letting the model compose interface freely. Tools owning their rendering contract is the constraint that makes the registry typed, reviewable and safe. The moment the model picks components, every guarantee on this page evaporates.
