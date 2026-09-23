# Build a haikit app

> Hello, World! in whichever language the world picks — the smallest app that still shows what haikit is for. Nine steps, annotated line by line.

## Hello, World! — in whichever language the world picks

The smallest app that still shows what hai is for. The model offers “Hello, World!” in 120 languages, a picker appears in the transcript, and your click is what answers it. About 60 tokens reach the model; the other 1,900 stay in the browser.

The classic Hello, World is one print statement, and there is nothing to learn from porting that. So this one keeps the output and adds the only thing hai actually cares about: **a list the model shouldn't be holding, and a choice only a human can make.**

You'll ask for a greeting. The model calls a tool. A picker of 120 translations appears in the transcript. You click one, and the model greets you in it.

| channel | cost | what it carries |
| --- | --- | --- |
| **Model** | ~60 tok | a digest + the handle `ui_01` — billed every turn |
| **UI** | ~1,900 tok | the full payload over SSE — never enters context |

> [!NOTE]
> **Does the split pay at this scale?**
>
> With four greetings, no — put them in the prompt and move on. The architecture starts earning its keep at roughly the point where the payload exceeds what you'd happily re-send on *every* turn for the rest of the conversation. A hundred rows of anything is comfortably past that line.

## 01 · Scaffold

Add a new workspace beside the flights app.

**`terminal`** — *run*

```bash
# from the repo root
mkdir -p apps/hello/src/{shared,server} apps/hello/public
```

**`apps/hello/package.json`** — *new file*

```json
{
  "name": "hello",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "npm --prefix ../.. run build",
    "start": "node src/server/main.ts",
    "dev": "npm run build && npm start"
  },
  "dependencies": {
    "@haikit/core": "0.1.0",
    "@haikit/server": "0.1.0",
    "@haikit/client": "0.1.0",
    "@haikit/anthropic": "0.1.0",
    "zod": "^4.0.0"
  }
}
```

Copy `tsconfig.json` from `apps/flights` unchanged, then `npm install` at the repo root to link the workspace.

## 02 · Declare the contract

The only module both halves of your app import. The server implements it; the browser component renders against it. Nothing else is shared.

**`src/shared/surfaces.ts`** — *new file*

```ts
import { defineSurface, query, resolve } from "@haikit/core";   // 1
import { z } from "zod";                                  // 2

export const Greeting = z.object({
  code: z.string(),                                     // 3
  language: z.string(),
  text: z.string(),                                     // 4
  script: z.string(),
  rtl: z.boolean(),                                     // 5
  speakersM: z.number(),                                // 6
});
export type Greeting = z.infer<typeof Greeting>;              // 7

export const greetingPicker = defineSurface({
  name: "greeting_picker",                            // 8
  version: 1,                                          // 9
  props: z.object({ greetings: z.array(Greeting) }),    // 10

  actions: {                                            // 11
    choose: resolve(z.string()),                        // 12
  },

  queries: {                                            // 13
    filter: query(
      z.object({
        script: z.string().optional(),                  // 14
        rtl: z.boolean().optional(),
      }),
      "Greetings in a given script or writing direction", // 15
    ),
  },
});
```

**1** Three constructors — and the entire vocabulary this file needs. A contract declares *what exists* and never what happens, so there is nothing else to import here.

  - **`defineSurface`** — Declares one renderable thing — a picker, a card, a table — as a named, versioned shape. It returns an object with an `.implement()` method the server calls in step 3, and a prop type the browser component renders against in step 5. This is the object that makes the two halves agree.
  - **`resolve(schema)`** — Declares an action that **answers a parked turn**. When the user triggers it, their value becomes the `tool_result` the model was waiting on. The schema describes what the component will send — here a language code. Declaring at least one is what lets a tool use `mode: "elicit"`.
  - **`query(schema, description?)`** — Declares a named accessor over the stored payload — the only route the model has past the digest. The schema types its arguments; the description is spliced into the auto-generated `query_ui` tool so the model knows the accessor exists. Without at least one, the other 119 rows are unreachable.

There is also `inform(schema)` for actions that add context without blocking; step 8 uses it.

↳ **Why helpers instead of object literals.** `resolve(z.string())` returns `ActionSpec<"resolve", string>`, preserving `"resolve"` as a literal type. Hand-writing `{ kind: "resolve", input: z.string() }` widens `kind` to `"resolve" | "inform"`, and the elicit check then cannot prove a resolve action exists — so `mode: "elicit"` stops compiling *even though you declared one*. It fails closed, which is the safe direction, but the error points at the tool in step 4 rather than at this line.

**2** Every field above needs a schema because props cross two trust boundaries — the server validates them before storing the payload, and the client validates again before mounting the component. `@haikit/core` accepts schemas *structurally*: anything with a `.parse()` method works, so zod is this app's choice rather than the framework's dependency.

**3** Stable identity. This is the value a click sends back, so it must survive filtering and sorting in the browser.

**4** The payload the component renders. Note it never appears in the digest — the model is told *how many* greetings there are, not what they say.

**5** The field that justifies the whole split: the browser needs it to lay out Arabic; the model has no use for it whatsoever.

**6** Exists so `digest` and `choose` can compute “most spoken” and a rank server-side, without a second lookup.

**7** One source of truth for the type. `public/components.js` imports this exact type through JSDoc, which is how the browser half stays honest.

**8** The registry key. It must match the key in the client's `registry` object or the surface renders an error card.

**9** Bump this when `props` changes shape. Old persisted payloads then render a placeholder instead of crashing a week-old conversation.

**10** Validated twice — server-side before the payload is stored, client-side before the component mounts.

**11** The complete list of interactions that may reach the server. This *is* the allowlist; there is no second security config to keep in sync.

**12** `resolve` means this action answers a parked turn. Declaring at least one is what makes `mode: "elicit"` compile in step 4.

**13** Named accessors over the stored payload. There is deliberately no raw dereference — the model cannot ask for “everything”.

**14** Both filters optional, so `query_ui(handle, "filter", {})` is legal and returns the top rows rather than erroring.

**15** This string is spliced into the generated `query_ui` tool description, so the model learns what it can ask for.

> [!NOTE]
> **Why rtl is the interesting field**
>
> Text direction is exactly the kind of prop that justifies the split. The component needs it to render Arabic correctly. The model has no use for it at all — knowing that Hebrew is right-to-left changes nothing about what it says next.
>
> Props exist for the browser. The digest exists for the model. They are different audiences, and the contract is where you stop pretending otherwise.

## 03 · Implement the server half

Three blocks, one destination. **Everything this file returns ends up as text in the model's context** — what differs is when it is produced and how it gets there. That is why the whole file is amber: it is the model-facing half of the surface.

### `digest`

```ts
digest(props, { handle }) => string
```

**→** the `tool_result` for this render, then re-sent on every later turn

Runs exactly once, when `ctx.render()` stores the payload. Its return value is the model's *entire* knowledge of those 120 rows — everything it can say without a dereference comes from this one string. Because it is re-sent every turn, the budget is tens of tokens, not hundreds.

One wrinkle for `elicit` surfaces: the digest does *not* reach the model at render time. A parked tool never received a `tool_result`, so the framework holds the digest and ships it with the resolution instead.

### `actions`

```ts
actions(value, { props, handle }) => string
```

**→** the `tool_result` that unparks the turn (`resolve`), or a new user message (`inform`)

Runs once per interaction, after `value` is validated against the schema you declared in the contract. The return string has **two audiences**: the model receives it as the answer it was waiting for, and the browser renders it verbatim as the `↳` line in the transcript. It has to read well to a person and be precise for a model at the same time.

Return a string even on failure. `undefined` leaves the parked `tool_use` unanswered, and a conversation in that state can never be sent again.

### `queries`

```ts
queries(args, { props, cap }) => Capped
```

**→** `capped.text` becomes the `tool_result` for a `query_ui` call

The only block that might never run. It fires when the model dereferences the handle — zero times in a short conversation, repeatedly in a long one. `Capped` is constructible only through `ctx.cap`, which is what stops an unbounded result from landing in context.

Every call is permanent, so a rich `digest` is the cheapest way to avoid one: each fact you precompute up there is a dereference that never happens down here.

**`src/server/surfaces.ts`** — *new file*

```ts
import type { Greeting } from "../shared/surfaces.ts";      // 1
import { greetingPicker } from "../shared/surfaces.ts";

const fmt = (g: Greeting) =>                                // 2
  `${g.language} (${g.code}): ${g.text} — ${g.script}, ${g.speakersM}M`;

const bySpeakers = (a: Greeting, b: Greeting) => b.speakersM - a.speakersM;  // 3

export const greetingPickerServer = greetingPicker.implement({  // 4
  digest(props, { handle }) {                             // 5
    const scripts = new Set(props.greetings.map((g) => g.script));
    const top = [...props.greetings].sort(bySpeakers).slice(0, 3);  // 6

    return [
      `${props.greetings.length} translations in ${scripts.size} scripts.`,  // 7
      `Most spoken: ${top.map((g) => g.language).join(", ")}.`,    // 8
      `${props.greetings.filter((g) => g.rtl).length} right-to-left.`,  // 9
      `Rendered as ${handle}.`,                             // 10
    ].join(" ");
  },

  actions: {
    choose(code, { props }) {                             // 11
      const g = props.greetings.find((x) => x.code === code);
      if (!g) return `Selection failed: unknown code ${code}.`;  // 12

      const rank = [...props.greetings].sort(bySpeakers)
        .findIndex((x) => x.code === code) + 1;               // 13
      return (
        `Chose ${g.language}: "${g.text}". ${g.script} script, ` +  // 14
        `${g.rtl ? "right-to-left" : "left-to-right"}, ${g.speakersM}M speakers. ` +
        `Rank: #${rank} of ${props.greetings.length} by speakers.`
      );
    },
  },

  queries: {
    filter(args, { props, cap }) {                        // 15
      const rows = props.greetings
        .filter((g) => (args.script ? g.script === args.script : true))  // 16
        .filter((g) => (args.rtl != null ? g.rtl === args.rtl : true))  // 17
        .sort(bySpeakers);                                // 18
      return cap(rows, fmt);                              // 19
    },
  },
});
```

**1** `import type` — the contract carries no runtime code into the server bundle, only shapes.

**2** One row formatter, reused by every query. Keeps dereference output consistent no matter which accessor produced it.

**3** Shared comparator. Using it in *both* `digest` and `choose` means “most spoken” can't mean two different things in the same conversation.

**4** `implement` binds this to the contract. TypeScript now requires exactly the declared action and query keys — no more, no fewer.

**5** Required by the type; a surface without it does not compile. `handle` is injected so you can name the pointer in the text.

**6** Copy before sorting — `Array.prototype.sort` mutates, and mutating `props` here would corrupt the payload the browser is already rendering.

**7** Grounds “how many”, the cheapest question to get wrong.

**8** Grounds the question users actually ask. Without this line the model answers it anyway — from nothing.

**9** Anticipates the dereference in step 7. A digest that pre-answers a likely question saves a permanent round trip.

**10** The pointer. Omit it and the model has no handle to pass to `query_ui`, so the other 113 rows become unreachable.

**11** Signature is derived from the contract: `code` is typed `string` because `choose` was declared `resolve(z.string())`.

**12** Action handlers must return a string even on failure — this value becomes the `tool_result`, so a silent `undefined` would break the turn.

**13** Rank is the single highest-value line here. It is how the model says something true about 119 rows it never received.

**14** Note this carries facts the digest omitted. One row is cheap, so the resolution is where you spend tokens on precision.

**15** `cap` is injected per call, already bound to the collection's total — that is how it can report “7 of 120”.

**16** Plain data work. Queries are ordinary functions; nothing here is framework magic.

**17** `!= null` rather than a truthiness check, so an explicit `rtl: false` filters for left-to-right instead of being ignored.

**18** Sort **before** capping. An unsorted cap returns an arbitrary 8, which misleads as badly as silent truncation.

**19** The only way to produce this function's return type. Forgetting it is the compile error you will trigger deliberately in step 9.

And the data. Six rows to start; add as many as you like.

**`src/server/data.ts`** — *new file*

```ts
import type { Greeting } from "../shared/surfaces.ts";

export const GREETINGS: Greeting[] = [
  { code: "en", language: "English",  text: "Hello, World!",        script: "Latin",    rtl: false, speakersM: 1500 },
  { code: "zh", language: "Mandarin", text: "你好，世界！",          script: "Han",      rtl: false, speakersM: 1100 },
  { code: "es", language: "Spanish",  text: "¡Hola, mundo!",        script: "Latin",    rtl: false, speakersM: 560 },
  { code: "ar", language: "Arabic",   text: "مرحبا بالعالم!",       script: "Arabic",   rtl: true,  speakersM: 420 },
  { code: "ja", language: "Japanese", text: "こんにちは世界！",      script: "Japanese", rtl: false, speakersM: 125 },
  { code: "he", language: "Hebrew",   text: "שלום, עולם!",          script: "Hebrew",   rtl: true,  speakersM: 9 },
];
```

> [!NOTE]
> **The digest is the hard part**
>
> `"120 greetings."` is the lazy version and it compiles. Ask *“which one has the most speakers?”* and the model will produce a confident, invented answer — it has a count and nothing else, and it has no way to know that it doesn't know.
>
> Precompute the handful of facts the next turn or two will plausibly need. Everything past that becomes a lookup instead of a guess.

## 04 · Write the tool

Tools are plain async functions. `ctx.render` does the whole dual channel — allocates the handle, runs your digest, persists the payload, emits the UI events, returns the `tool_result`.

**`src/server/tools.ts`** — *new file*

```ts
import { defineTool } from "@haikit/core";
import { z } from "zod";
import { GREETINGS } from "./data.ts";
import { greetingPickerServer } from "./surfaces.ts";

export const listGreetings = defineTool({
  name: "list_greetings",                               // 1
  description:                                            // 2
    "Show the greeting picker. BLOCKS until the user chooses a language — the " +
    "component is the question, so do not also ask them to type one.",
  input: z.object({}),                                    // 3
  inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },  // 4

  async run(_input, ctx) {                                 // 5
    return ctx.render(                                    // 6
      greetingPickerServer,                               // 7
      { greetings: GREETINGS },                           // 8
      { mode: "elicit" },                                 // 9
    );
  },
});

export const tools = [listGreetings];                      // 10
```

**1** What the model sees and calls. Snake case by convention; it has to be stable, since it appears in stored conversation history.

**2** Prompt text, not documentation. “BLOCKS” and “do not also ask them to type one” are the two clauses that stop the model narrating the options in prose.

**3** No input at all — the purest demonstration that `ctx.render` is doing all the work.

**4** Deliberately separate from the runtime schema above: this is the JSON Schema the model reads, while `input` is what the server validates against. `additionalProperties: false` pairs with the `strict: true` default.

**5** A plain async function. Nothing in a tool body is framework-specific until you call `ctx`.

**6** One call does the entire dual channel: allocate a handle, run `digest`, persist the payload, emit the UI events, and return the `tool_result`.

**7** The *implementation*, not the contract. Passing `greetingPicker` here would be a type error — the runtime needs the digest and handlers.

**8** Validated against the contract's prop schema before it is stored, so a bad payload fails here rather than in the browser.

**9** Compiles only because the surface declares a `resolve` action. A blocking tool with no way to unblock is a compile error, not a deadlocked conversation.

**10** Registered in `main.ts`. Note there is no `query_ui` in this array — the framework derives that one.

> [!WARNING]
> **Note the absence**
>
> There's no `query_ui` tool here, and you never write one. The framework derives it from your surfaces' declared queries, so it always exists and can never drift from what they actually support.

## 05 · Build the component

Plain JS, no build step. Its only channel to the server is `ctx.send(action, value)` — it cannot name a tool, a handler, or an endpoint.

**`public/components.js`** — *new file*

```js
/** @typedef {import("../src/shared/surfaces.ts").Greeting} Greeting */  // 1

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;                // 2
  return n;
};

export const registry = {
  greeting_picker: {                                      // 3
    mount(el, props, ctx) {                               // 4
      let scriptFilter = null;                            // 5
      let state = ctx.state;                               // 6
      let picked = null;

      const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();  // 7

      const render = () => {
        el.replaceChildren();                             // 8
        const live = state === "live" && ctx.mode === "elicit";  // 9

        const chips = h("div", "chips");
        for (const sc of [null, ...scripts]) {
          const b = h("button", scriptFilter === sc ? "chip on" : "chip", sc ?? "all");
          b.onclick = () => { scriptFilter = sc; render(); };  // 10
          chips.append(b);
        }

        const rows = props.greetings.filter((g) => !scriptFilter || g.script === scriptFilter);
        const list = h("div", "rows");
        for (const g of rows) {
          const row = h("div", live ? "row selectable" : "row");

          const greeting = h("span", "greeting", g.text);
          if (g.rtl) greeting.dir = "rtl";                    // 11

          row.append(greeting, h("span", "lang", g.language));
          if (live) row.onclick = () => ctx.send("choose", g.code);  // 12
          list.append(row);
        }

        el.append(chips, list);
      };

      render();
      return {                                              // 13
        freeze(sel) { state = "frozen"; picked = sel ?? null; render(); },  // 14
      };
    },
  },
};
```

**1** Pulls the type straight out of the contract. This file is checked by `tsc` with `checkJs`, so changing a prop server-side breaks the browser build too.

**2** `textContent`, never `innerHTML`. Tool payloads are untrusted input — this is the line that keeps a malicious greeting from becoming markup.

**3** Key must match the surface's `name`. An unregistered component renders an error card rather than an improvised UI.

**4** The framework calls this once, with validated props. Everything below is ordinary DOM code — there is no component model to learn.

**5** Local state. It is not in the contract, so there is no channel for it to reach the server even if you wanted one.

**6** Copied out of `ctx` because `freeze()` mutates it later. Reading `ctx.state` inside `render` would always show the mount-time value.

**7** Derived in the browser from data it already has. The server was never asked, and the model never learns the script list exists.

**8** Full re-render on every local change. At 120 rows that is free; virtualize only when measurement says to.

**9** Two conditions. A display surface is never clickable, and an elicit surface stops being clickable the moment its turn resolves.

**10** The local tier: mutate, re-render, done. No `ctx.send`, no round trip, no token cost. If filtering cost a model call the app would feel broken.

**11** The payoff of the `rtl` prop. The browser needs one line to lay out Arabic correctly; the model needed to know nothing about it.

**12** The single declared channel to the server. `"choose"` must match the contract exactly — a typo surfaces as `unbound action` at runtime.

**13** The mount return value is the component's handle back to the framework.

**14** Called when the turn resolves, with the value the user picked. Re-rendering here is what flips the badge to “resolved” and stops accepting clicks.

> [!NOTE]
> **Local vs declared**
>
> The script chips are *local*: they filter rows already in the browser and never touch the server. Only `choose` round-trips. If filtering a list cost a model round trip, the app would feel broken no matter how good the model is.

## 06 · Wire it up and run

**`src/server/main.ts`** — *new file*

```ts
import http from "node:http";
import { createHai, memoryStore, nodeHandler } from "@haikit/server";
import { anthropic } from "@haikit/anthropic";
import { tools } from "./tools.ts";
import { greetingPickerServer } from "./surfaces.ts";

const hai = createHai({
  model: anthropic({ model: "claude-opus-5", effort: "low" }),  // 1
  store: memoryStore(),                                   // 2
  tools,                                                  // 3
  surfaces: [greetingPickerServer],                       // 4
  system: `You greet people in their chosen language through a UI that renders
tool results as interactive components.

Tools return a short DIGEST into your context. The full dataset goes to the
user's browser, addressable by the handle in the digest (e.g. ui_01).

- Never state a specific fact about languages you have not seen. Use
  query_ui. Do not guess.                                // 5
- list_greetings renders a picker and blocks until the user chooses. The
  component is the question — do not also ask them to type one.          // 6
- Once they choose, greet them in that language and stop.`,
});

const handleHai = nodeHandler(hai, "/hai");                  // 7

http
  .createServer(async (req, res) => {
    if (await handleHai(req, res)) return;                 // 8
    // static assets — the next block
  })
  .listen(5175, () => console.log("hello  http://localhost:5175"));
```

**1** The model seam. Swap in your own object with a `generate()` method and the runtime cannot tell — that is how `apps/flights` ships a scripted model for demos.

**2** The one line to change before shipping. A parked elicit turn is durable state; lose it and that conversation can never be sent again.

**3** Your tools. The framework appends `query_ui` to this list at construction time.

**4** Registering the surface is what gives `query_ui` something to dereference. Omit it and the handle in your digest resolves to nothing.

**5** The anti-hallucination clause. It only works because the digest genuinely contains the common answers — an instruction not to guess, over a lazy digest, just produces hedging.

**6** Stops the model narrating the options in prose alongside the picker, which is the most common first-run annoyance.

**7** Mounts `POST /hai/chat` and `POST /hai/interact`. Everything about the elicit state machine lives behind these two routes.

**8** Returns `true` if it handled the request, so hai composes with whatever else your server does rather than owning the process.

And the static half of the server. There is no bundler here, so the app serves its own `public/` plus the client runtime straight out of its package — the browser loads `hai-client` as plain ESM.

**`src/server/main.ts`** — *the next block*

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const CLIENT = path.resolve(HERE, "../../../../packages/hai-client/src");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// inside createServer, after the `if (await handleHai(...)) return;` line:
const url = new URL(req.url ?? "/", "http://localhost");
const clientPrefix = "/hai-client/";
let file: string;
if (url.pathname.startsWith(clientPrefix)) {
  file = path.join(CLIENT, url.pathname.slice(clientPrefix.length));
  if (!file.startsWith(CLIENT)) return void res.writeHead(403).end("forbidden");
} else {
  file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (!file.startsWith(PUBLIC)) return void res.writeHead(403).end("forbidden");
}

try {
  const body = await fs.readFile(file);
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(body);
} catch {
  res.writeHead(404).end("not found");
}
```

The two `startsWith` checks are not decoration — without them a request for `/../../.env` escapes the directory you meant to expose.

And the page. `hai-client` ships the default UI — the shell, transcript, composer and context inspector — so this is the whole of it:

**`public/index.html`** — *new file*

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>hello — built on haikit</title>
    <link rel="stylesheet" href="/hai-client/hai.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { mountChat } from "/hai-client/app.js";
      import { registry } from "./components.js";

      mountChat({
        root: document.querySelector("#app"),
        registry,
        title: "hello",
        suggestions: ["greet me", "which ones are right-to-left?"],
      });
    </script>
  </body>
</html>
```

There is no `app.js`. `mountChat` builds the shell, wires the composer, renders the transcript and mounts your surfaces; `hai.css` styles everything it renders. Your own `styles.css` holds only what *your* components emit — `.chips`, `.row`, `.greeting` — plus any `--hai-*` token you want to override.

> [!NOTE]
> **Where the line is**
>
> The framework styles what the framework renders. It deliberately does not style the inside of your surfaces — the moment it did, it would be dictating what your UI looks like.
>
> `mountChat` is a convenience, not the API. It is built from `createChat` and `renderTranscript`, and when the default shell stops fitting you drop to those and write your own. That is the expected path, not a failure.

**`terminal`** — *run*

```bash
# from the repo root — `build` lives there, not in the app
npm run build
node apps/hello/src/server/main.ts

# or, from apps/hello/ — the passthrough scripts from step 1
npm run dev
```

> [!WARNING]
> **You need a model here**
>
> `anthropic()` reads `ANTHROPIC_API_KEY` from the environment. Without one the page loads and the picker never appears — the first message fails with *“Could not resolve authentication method”* in the transcript.
>
> No key? `ModelAdapter` is a one-method interface. The adapter below needs no network, drives every step in this tutorial, and is what the screenshots were taken against.

<details>
<summary>Optional — a scripted model, so you can finish without a key</summary>

One file and a two-line change to `main.ts`. Note what it never does: **it does not import `GREETINGS`**. It sees only what a real model sees — the digest and the tool results — and every claim it makes is pulled back out of those strings.

That is the point. It is a working demonstration of the grounding discipline rather than a cheat: delete the `Rank:` clause from `choose` and this model stops claiming a rank, exactly as a real one would.

**`src/server/scripted.ts`** — *new file*

```ts
import type { ModelAdapter, ModelRequest, ModelResponse } from "@haikit/core";

let counter = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use", id: `toolu_scripted${++counter}`, name, input,
});

// Mirrors the strings `choose` returns in ./surfaces.ts.
const CHOSE = /Chose ([^:]+): "([^"]+)"/;
const RANK = /Rank: #(\d+) of (\d+)/;
const MATCHED = /^(\d+) of (\d+) match/m;
const SCRIPTS = ["latin", "arabic", "hebrew", "han", "japanese"];

async function say(text: string, onTextDelta: (t: string) => void): Promise<ModelResponse> {
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    onTextDelta(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

export function scripted(): ModelAdapter {
  return {
    id: "scripted",

    async generate({ messages, onTextDelta }: ModelRequest): Promise<ModelResponse> {
      const last = messages.at(-1);
      const results = Array.isArray(last?.content)
        ? (last.content as any[]).filter((b) => b?.type === "tool_result")
            .map((b) => b.content).join("\n")
        : "";

      // ── reacting to a tool result ──────────────────────────
      if (results) {
        const chose = results.match(CHOSE);
        if (chose) {
          const [, language, greeting] = chose;
          const rank = results.match(RANK);
          const where = rank ? `${language}, #${rank[1]} of ${rank[2]} by speakers` : language;
          const dir = /right-to-left/.test(results) ? " It reads right to left." : "";
          return say(`${greeting}\n\n— ${where}.${dir}`, onTextDelta);
        }
        const m = results.match(MATCHED);
        if (m) return say(`${m[1]} of the ${m[2]} match — they're listed above.`, onTextDelta);
        return say("Done.", onTextDelta);
      }

      // ── reacting to a user message ─────────────────────────
      const text = (typeof last?.content === "string" ? last.content : "").toLowerCase();
      const handle = JSON.stringify(messages).match(/ui_\d+/)?.[0];

      // An `inform` arrives as a plain user turn — check it BEFORE the
      // keyword branches, or its text re-triggers a tool.
      if (text.startsWith("[ui interaction]")) return say("Noted.", onTextDelta);

      if (handle && /(right-to-left|rtl|left-to-right|ltr|script|latin|arabic|hebrew|han|japanese)/.test(text)) {
        const args: Record<string, unknown> = {};
        if (/right-to-left|rtl/.test(text)) args.rtl = true;
        else if (/left-to-right|ltr/.test(text)) args.rtl = false;
        const script = SCRIPTS.find((sc) => text.includes(sc));
        if (script) args.script = script[0]!.toUpperCase() + script.slice(1);

        onTextDelta("Checking the full list.");
        return {
          content: [{ type: "text", text: "Checking the full list." },
                    toolUse("query_ui", { handle, query: "filter", args })],
          stop_reason: "tool_use",
        };
      }

      if (/greet|hello|hi\b|hey|language|world|start/.test(text)) {
        onTextDelta("Pick a language.");
        return {
          content: [{ type: "text", text: "Pick a language." },
                    toolUse("list_greetings", {})],
          stop_reason: "tool_use",
        };
      }

      return say(`Try: "greet me", then "which ones are right-to-left?"`, onTextDelta);
    },
  };
}
```

Then gate it behind an env var, so a real key still wins when you have one:

**`src/server/main.ts`** — *edit*

```ts
import { scripted } from "./scripted.ts";

const SCRIPTED = process.env.HAI_SCRIPTED === "1";

const hai = createHai({
  model: SCRIPTED ? scripted() : anthropic({ model: "claude-opus-5", effort: "low" }),
  // ...unchanged
});
```

**`package.json`** — *edit*

```json
"mock": "npm run build && HAI_SCRIPTED=1 node src/server/main.ts"
```

`npm run mock` from `apps/hello/`, and the checkpoint below works end to end: the picker parks the turn, clicking Hebrew returns שלום, עולם! with “#6 of 6 by speakers, reads right to left”, and asking which are right-to-left fires a real `query_ui` dereference.

</details>

> [!TIP]
> **Checkpoint**
>
> Say *“greet me”*. You should see a tool row, a picker under it, the badge reading **awaiting selection**, and the status line saying the turn is parked. In the inspector, the model context holds your one-sentence digest — not the languages.
>
> Click a row. The badge flips to **resolved**, an interaction line appears with the rank, and the model finishes the *same turn*: **¡Hola, mundo!**

> [!WARNING]
> **If nothing happens on click**
>
> Check that `ctx.send`'s first argument exactly matches an action key in your contract. A typo surfaces as `unbound action` in the transcript — that's the server-side binding table refusing something it wasn't told about.

## 07 · Add a dereference

You declared a `filter` query in step 2 and implemented it in step 3, so this already works — try asking *“which ones are right-to-left?”*

The handle in the digest is a pointer; `query_ui` is the dereference. The model gets back only the matching slice:

**`tool_result`** — *what the model receives*

```text
7 of 120 match. 7 shown:
Arabic (ar): مرحبا بالعالم! — Arabic, 420M
Urdu (ur): ہیلو ورلڈ! — Arabic, 230M
Persian (fa): سلام دنیا! — Arabic, 130M
Hebrew (he): שלום, עולם! — Hebrew, 9M
...
```

> [!NOTE]
> **Why cap() is the only constructor**
>
> Every dereference is **permanent** — it lands in `messages[]` and is re-sent on every turn after. A filter matching all 120 and returning all 120 would undo the split you just built, silently, on one unlucky argument.
>
> So `cap()` is the only thing that can produce a query's return type, and it always reports what it dropped. Silent truncation would be worse than no cap at all: the model would say “there are 7 RTL languages” when there are 40.

## 08 · Add a display surface

Not everything should block. A card showing the chosen greeting large is an *artifact* of the turn, not a question — the model keeps talking whether or not you touch it.

**`src/shared/surfaces.ts`** — *append*

```ts
import { inform } from "@haikit/core";

export const greetingCard = defineSurface({
  name: "greeting_card",
  version: 1,
  props: z.object({ greeting: Greeting }),
  actions: {
    // `inform` enriches the conversation without ever having blocked it.
    copy: inform(z.object({ code: z.string() })),
  },
});
```

**`src/server/surfaces.ts`** — *append*

```ts
export const greetingCardServer = greetingCard.implement({
  digest(props, { handle }) {
    const g = props.greeting;
    return `Card for ${g.language}: "${g.text}" (${g.script}). Rendered as ${handle}.`;
  },
  actions: {
    copy(value, { props }) {
      return `Copied the ${props.greeting.language} greeting (${value.code}) to the clipboard.`;
    },
  },
  queries: {},
});
```

Then a tool that renders it — note the missing third argument:

**`src/server/tools.ts`** — *append*

```ts
export const showGreeting = defineTool({
  name: "show_greeting",
  description: "Show one greeting as a large card. Display-only — does not block.",
  input: z.object({ code: z.string() }),
  inputJsonSchema: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const greeting = GREETINGS.find((g) => g.code === input.code);
    if (!greeting) return ctx.text(`Unknown language code ${input.code}.`);

    // No third argument — display is the default. Resolves immediately.
    return ctx.render(greetingCardServer, { greeting });
  },
});
```

Register the new surface and tool in `main.ts`, add a component, done.

| Use | When | Action kind |
| --- | --- | --- |
| elicit | The model's next sentence depends on the answer | resolve |
| display | It doesn't — the UI is a result, not a question | inform (or none) |

## 09 · Break it on purpose

Best way to learn what the framework is actually holding for you. Make each edit, run `npx tsc -p apps/hello --noEmit`, then undo it.

**`src/server/surfaces.ts`** — *try each, then revert*

```ts
// 1 — delete the digest function entirely
error TS2741: Property 'digest' is missing in type ...

// 2 — return the rows directly instead of calling cap()
filter(args, { props }) { return props.greetings; }
error TS2739: Type 'Greeting[]' is missing the following properties from
              type 'Capped': [CAPPED], text, shown, total

// 2b — or hand-build an object that looks right
filter() { return { text: "7 of 120", shown: 7, total: 120 }; }
error TS2741: Property '[CAPPED]' is missing — there is no runtime value
              for it, so cap() is the only constructor

// 3 — render greeting_card (no resolve action) as elicit
ctx.render(greetingCardServer, props, { mode: "elicit" });
error TS2345: Property '⚠ this surface declares no resolve action — an
              elicit turn could never be unparked' is missing

// 4 — add a handler you never declared
actions: { choose: ..., deleteEverything: () => "boom" }
error TS2353: Object literal may only specify known properties
```

> [!TIP]
> **What you just proved**
>
> Each of those is a bug that shipped in the prototype this framework was extracted from. A lazy digest produced a confidently invented fact. An uncapped filter put a whole payload into context permanently. They're compile errors now, not review items — `npm run typetest` in the repo root asserts exactly this, so a guarantee that quietly stops working fails CI.

## Where to go next

You now have every concept in the framework, in about 150 lines. The next app differs only in how much data it holds and how consequential the click is.

### Before you ship anything real

- **Replace `memoryStore()`.** A parked elicit turn is durable state — lose `pending` and that conversation can never be sent again. The interface is four methods; a Postgres implementation is an afternoon.
- **Decide what stale means.** Greetings don't rot, but prices and availability do. TTL the payload, re-validate on resolve, or freeze it with an explanation. Silently resolving stale data is the wrong answer.
- **Gate the destructive tools.** An approval card is structurally identical to what you built in steps 2–6: a two-button surface with a `resolve` action. Same machinery, no new concepts.

### Things that will tempt you

**A `render_ui(component, props)` tool** so the model can compose interface freely. It feels flexible and it dissolves every guarantee in step 9 — the registry stops being typed, reviewable, or bounded. Tools owning their rendering contract is the constraint that makes the rest work.

**Putting the rows in context “just this once”** because a digest is fiddly to write. Remember context is re-sent every turn: 120 greetings inline over a ten-turn conversation costs more than a hundred dereferences.
