import { appFile, packageFile } from "../excerpts.ts";
import type { PartDef } from "./types.ts";

/**
 * Part 2: how haikit implements Part 1, shown through the code of this app.
 *
 * Every `excerpt` block is read from source when the server starts. Most quote
 * this app (it is a complete haikit app, so it is the worked example), and the
 * rest quote the haikit packages installed in node_modules. A selector that
 * stops matching stops the server, so the lessons and the code can't drift
 * apart.
 */

const app = appFile;
const core = (rel: string) => packageFile("@haikit/core", rel);
const server = (rel: string) => packageFile("@haikit/server", rel);

export const part2: PartDef = {
  n: 2,
  title: "How haikit implements it",
  blurb:
    "The packages, the contract that both halves share, and the code that runs this introduction, quoted from the source the server is running.",
  lessons: [
    {
      id: "2.1",
      title: "Six packages and the lines between them",
      minutes: 3,
      summary: "Which package does what, and why the browser and the adapters never import the runtime.",
      blocks: [
        {
          kind: "p",
          text: "haikit is split so that each side imports only what it needs. `@haikit/core` holds the contracts and has no runtime dependencies, because the server and the browser both import it.",
        },
        {
          kind: "table",
          head: ["Package", "What it gives you"],
          rows: [
            ["`@haikit/core`", "`defineSurface`, `defineTool`, `cap`, the wire types, and the adapter interfaces. Runs anywhere."],
            ["`@haikit/server`", "The agent loop, the elicit state machine, the derived `query_ui` tool, and the HTTP routes."],
            ["`@haikit/client`", "The browser runtime and the default chat UI. Plain ES modules, no build step."],
            ["`@haikit/anthropic`", "The Claude model adapter."],
            ["`@haikit/postgres`", "A durable store, safe to share between several server instances."],
            ["`@haikit/react`", "Write surface components in React, typed from the contract."],
          ],
        },
        {
          kind: "diagram",
          text:
            "                  @haikit/core\n" +
            "           contracts, zero dependencies\n" +
            "        ▲             ▲               ▲\n" +
            "        │             │               │\n" +
            " @haikit/server  @haikit/client   adapters\n" +
            " agent loop      createChat()     @haikit/anthropic\n" +
            " elicit state    mountChat()      @haikit/postgres\n" +
            " routes + SSE    transcript\n" +
            "\n" +
            " @haikit/client never imports @haikit/server.\n" +
            " The only thing crossing that line is your contract module.",
        },
        {
          kind: "p",
          text: "Adapters import only `@haikit/core`, never the runtime. That keeps the model and the store swappable: this introduction runs a scripted guide when it has no API key and Claude when it has one, and the runtime can't tell them apart.",
        },
        {
          kind: "note",
          tone: "look",
          text: "The version in the header is read from the haikit packages this server has installed, when it starts. The code in Part 2 is read from those same packages, so it always matches the version you see.",
        },
      ],
      takeaways: [
        "core holds contracts and runs anywhere; server holds the loop; client holds the browser runtime.",
        "Adapters depend only on core, which is what makes the model and the store swappable.",
        "The browser never imports the server runtime; only the contract module crosses.",
      ],
      check: {
        question: "Which package must browser code never import?",
        options: ["`@haikit/core`", "`@haikit/server`", "`@haikit/client`"],
        answer: 1,
        why: "The server runtime holds the agent loop, the handlers and the binding table. All that crosses to the browser is your contract module, and only as types.",
      },
    },

    {
      id: "2.2",
      title: "One contract, declared once",
      minutes: 4,
      summary: "The module both halves import: props, the actions that may round-trip, and the queries the model may run.",
      blocks: [
        {
          kind: "p",
          text: "A surface is declared once, in a module the server and the browser both import. The declaration names the props schema, the actions that can reach the server, and the queries the model can run. It has no handlers and nothing specific to any UI library.",
        },
        { kind: "p", text: "Here's the contract for the checkpoint you've been answering, read from this app's source:" },
        {
          kind: "excerpt",
          file: app("src/shared/surfaces.ts"),
          pick: { region: "checkpoint" },
          lang: "ts",
        },
        {
          kind: "list",
          items: [
            "`answer: resolve(z.string())` is the only action. A checkpoint can do exactly one thing to the server: answer with an option id.",
            "The props carry the question and the options, but not the correct answer. The answer key never leaves the server; lesson 2.3 shows where it's used.",
            "`version` lets a later change to the component show a placeholder in old conversations instead of breaking them.",
          ],
        },
        { kind: "p", text: "The course map declares a query as well. This is what the guide uses to look up glossary terms:" },
        {
          kind: "excerpt",
          file: app("src/shared/surfaces.ts"),
          pick: { region: "course-map" },
          lang: "ts",
        },
        {
          kind: "p",
          text: "Schemas are accepted structurally: anything with a `parse` method works. This app uses zod, but core doesn't depend on it.",
        },
      ],
      takeaways: [
        "A surface is declared once, in a module both halves import: props, actions and queries, without handlers.",
        "Declaring an action is the only way to let a click reach the server.",
        "Props are everything the browser receives, so anything secret, such as an answer key, stays out of them.",
      ],
      check: {
        question: "Where must an action be declared for a click on it to reach the server?",
        options: ["In the component's click handler", "In the shared surface contract", "In the tool's description"],
        answer: 1,
        why: "The contract's action list is the allowlist. The server looks the action up there, and anything not declared is refused as an unbound action.",
      },
    },

    {
      id: "2.3",
      title: "The server half: digest, actions, queries",
      minutes: 5,
      summary: "Implementing the contract on the server, where the data and the decisions live.",
      blocks: [
        {
          kind: "p",
          text: "The server implements the contract with `.implement()`. TypeScript holds it to the declaration: `digest` is required, every declared action needs a handler, and every query has to return the result of `cap()`.",
        },
        {
          kind: "excerpt",
          file: app("src/server/surfaces.ts"),
          pick: { region: "checkpoint-server" },
          lang: "ts",
        },
        {
          kind: "list",
          items: [
            "`digest` writes what the model will see. It includes the options, so the model can talk about them, but not the answer.",
            "The `answer` handler grades the click against `CHECKS`, which only the server holds, and returns a label. The digest followed by that label becomes the tool result.",
            "If a handler throws, the click is refused: nothing is recorded and the surface stays live, so the learner can click again.",
          ],
        },
        { kind: "p", text: "And the course map's glossary query, which `query_ui` calls into:" },
        {
          kind: "excerpt",
          file: app("src/server/surfaces.ts"),
          pick: { region: "glossary-query" },
          lang: "ts",
        },
        {
          kind: "p",
          text: "`cap(rows, format, limits)` is the only way to produce a query result. Here it allows at most four entries and reports the rest as omitted.",
        },
      ],
      takeaways: [
        "implement() supplies digest, one handler per declared action, and one function per declared query.",
        "An action handler returns a label; for a resolve action, digest plus label become the tool result.",
        "A handler that throws refuses the click and leaves the surface live.",
      ],
      check: {
        question: "A checkpoint's answer handler throws because the option id is unknown. What happens?",
        options: [
          "The click is refused, nothing is recorded, and the surface stays live",
          "The model receives the error message as the tool result",
          "The conversation is closed",
        ],
        answer: 0,
        why: "Nothing is recorded until the handler succeeds. A click that fails can't half-happen, and the learner can simply try again.",
      },
    },

    {
      id: "2.4",
      title: "Tools render in one call",
      minutes: 4,
      summary: "How a tool chooses a surface and a mode, and how the welcome screen appeared before you typed anything.",
      blocks: [
        {
          kind: "p",
          text: "A tool decides when a surface appears and in which mode. `ctx.render` does the whole split in one call: it validates the props, stores the payload, allocates the handle, writes the digest, streams the props to the browser, and returns the digest as the tool result.",
        },
        {
          kind: "excerpt",
          file: app("src/server/tools.ts"),
          pick: { region: "lesson-tools" },
          lang: "ts",
        },
        {
          kind: "p",
          text: "The two tools differ only in the third argument. `show_lesson` renders in display mode and returns at once. `ask_checkpoint` passes `{ mode: \"elicit\" }` and parks the turn. Passing elicit for a surface without a `resolve` action is a compile error.",
        },
        { kind: "h", text: "Before the first message" },
        {
          kind: "p",
          text: "The welcome screen you saw first was shown by an **init** tool. `createHai({ init })` runs it at the start of every conversation, before the model's first turn, and records the call as if the model had made it. Its surface is elicit: its two buttons are a question, so the conversation was parked on it before you typed anything, and your choice was the first thing the model received.",
        },
        {
          kind: "excerpt",
          file: app("src/server/tools.ts"),
          pick: { region: "welcome" },
          lang: "ts",
        },
      ],
      takeaways: [
        "ctx.render validates, stores, digests and streams in one call, and returns the digest as the tool result.",
        "The mode argument is the only difference between showing something and asking something.",
        "An init tool runs at the start of every conversation, and an elicit init parks it before the model runs.",
      ],
      check: {
        question: "What does a tool get back when it calls ctx.render in display mode?",
        options: [
          "The full props, so the model can read them",
          "The digest and the handle",
          "Nothing until the user clicks",
        ],
        answer: 1,
        why: "ctx.render returns the digest as the tool result, along with the handle. The props went to the browser and never come back through the tool.",
      },
    },

    {
      id: "2.5",
      title: "The browser half: the registry",
      minutes: 4,
      summary: "Components that draw props and can only send declared actions back.",
      blocks: [
        {
          kind: "p",
          text: "In the browser, a **registry** maps surface names to components. A component is anything with `mount(element, props, ctx)`. It draws the props, and calls `ctx.send(action, value)`, its only channel back to the server.",
        },
        {
          kind: "excerpt",
          file: app("public/components.js"),
          pick: { region: "checkpoint-component" },
          lang: "js",
        },
        {
          kind: "list",
          items: [
            "`ctx.mode` and `ctx.state` say whether the surface is a live question. Once it's answered, the runtime calls `freeze(selection)` and the component stops offering choices.",
            "Everything is built with `textContent`, never HTML. Tool payloads are untrusted input.",
            "The registry is an allowlist. A surface name it doesn't contain renders an error card, never improvised UI.",
          ],
        },
        {
          kind: "p",
          text: "This file is plain JavaScript with no build step, typechecked against the shared contract through JSDoc. With `@haikit/react` the same component is a function typed by `SurfaceProps<typeof checkpoint>`; `examples/hello-react` in the haikit repository shows one.",
        },
      ],
      takeaways: [
        "A component is anything with mount(element, props, ctx); the registry maps surface names to components.",
        "ctx.send(action, value) is the only way back to the server, and only declared actions are accepted.",
        "freeze(selection) is called when a question has been answered.",
      ],
      check: {
        question: "A component calls ctx.send(\"grade\", \"a\"), but the contract declares only answer. What happens?",
        options: [
          "The server refuses it as an unbound action",
          "The server routes it to the closest matching tool",
          "It reaches the model as a user message",
        ],
        answer: 0,
        why: "The server looks the action up in the contract before anything else happens. Undeclared actions have no handler, so the request is refused.",
      },
    },

    {
      id: "2.6",
      title: "Wiring it up",
      minutes: 4,
      summary: "createHai, nodeHandler and mountChat: the three calls that turn the pieces into this app.",
      blocks: [
        {
          kind: "p",
          text: "Three calls connect everything. `createHai` builds the runtime from a model, a store, tools and surfaces. `nodeHandler` serves its routes. `mountChat` builds the page you're reading.",
        },
        {
          kind: "excerpt",
          file: app("src/server/main.ts"),
          pick: { region: "create-hai" },
          lang: "ts",
        },
        {
          kind: "p",
          text: "The model is an adapter: anything with a `generate` method. Without an API key this introduction uses a scripted guide, which lives in the app, not the framework. It reads only what a real model would see, the digests and tool results, and takes every fact it states from those strings.",
        },
        { kind: "p", text: "In the browser, the whole page is one call:" },
        {
          kind: "excerpt",
          file: app("public/index.html"),
          pick: { region: "mount" },
          lang: "js",
        },
        {
          kind: "note",
          tone: "look",
          text: "The badge in the header names the model that is answering you. On a phone it's hidden to save room.",
        },
      ],
      takeaways: [
        "createHai takes a model, a store, tools, surfaces, a system prompt and an optional init tool.",
        "A model adapter is one generate method; the runtime owns the loop, including parking and resuming.",
        "mountChat builds the default UI: header, transcript, message box and the model context drawer.",
      ],
      check: {
        question: "What does a custom model adapter have to implement?",
        options: [
          "A generate method that takes the request and returns content and a stop reason",
          "A subclass of the Anthropic SDK client",
          "The agent loop, including parking and resuming turns",
        ],
        answer: 0,
        why: "ModelAdapter is a single method. The runtime owns the loop, which is why a parked turn works the same with any model.",
      },
    },

    {
      id: "2.7",
      title: "What haikit refuses to compile",
      minutes: 4,
      summary: "Part 1's rules are type errors, and the repository tests that they stay that way.",
      blocks: [
        {
          kind: "p",
          text: "The rules from Part 1 aren't conventions you're asked to follow. Each one is a type error. The excerpts below break them on purpose, using this introduction's own surfaces, and each marked line has to fail to compile: `npm run typecheck` reports any `@ts-expect-error` whose line compiles fine. If a haikit release ever loosened one of these rules, this introduction would stop building. haikit's own repository runs the same kind of check on every change.",
        },
        {
          kind: "excerpt",
          file: app("test/guarantees.ts"),
          pick: { region: "no-digest" },
          lang: "ts",
          caption: "No digest, no surface.",
        },
        {
          kind: "excerpt",
          file: app("test/guarantees.ts"),
          pick: { region: "uncapped" },
          lang: "ts",
          caption: "A query can't return raw rows; only cap() builds its result.",
        },
        {
          kind: "excerpt",
          file: app("test/guarantees.ts"),
          pick: { region: "elicit-without-resolve" },
          lang: "ts",
          caption: "Elicit needs a resolve action, or nothing could unpark the turn.",
        },
        {
          kind: "excerpt",
          file: app("test/guarantees.ts"),
          pick: { region: "undeclared-action" },
          lang: "ts",
          caption: "Undeclared actions don't exist.",
        },
        {
          kind: "table",
          head: ["What could go wrong", "What prevents it"],
          rows: [
            ["The model describes rows it never received", "`digest` is required on every surface"],
            ["A filter matches everything and dumps the payload into context", "A query result can only come from `cap()`"],
            ["Injected content wires a button to `delete_account`", "The browser sends `{ handle, action, value }` and can't name a target"],
            ["An undeclared element quietly round-trips", "Undeclared means local; the contract is the allowlist"],
            ["A blocking tool with no way to unblock it", "`mode: \"elicit\"` only compiles with a `resolve` action"],
          ],
        },
      ],
      takeaways: [
        "A missing digest, an uncapped query, elicit without resolve and an undeclared action are all compile errors.",
        "This introduction's typecheck fails if any of these errors ever stops happening.",
      ],
      check: {
        question: "Which of these is a compile error in haikit?",
        options: [
          "A display surface that declares no actions",
          "Rendering in elicit mode a surface that declares no resolve action",
          "A query that matches zero rows",
        ],
        answer: 1,
        why: "Without a resolve action nothing could ever answer the parked turn, so the elicit overload refuses that surface at compile time.",
      },
    },

    {
      id: "2.8",
      title: "Under the hood: the parked turn",
      minutes: 4,
      summary: "The state Part 1 described, as the runtime actually stores and checks it.",
      blocks: [
        { kind: "p", text: "Here's the pending record from lesson 1.6, as `@haikit/core` declares it:" },
        {
          kind: "excerpt",
          file: core("src/index.ts"),
          pick: { start: "export interface Pending {" },
          lang: "ts",
        },
        {
          kind: "p",
          text: "When a click arrives, the runtime checks it in this order before any handler runs: the handle belongs to this conversation, it isn't frozen, the action is declared, its value parses, and a `resolve` is for the surface the turn is waiting on.",
        },
        {
          kind: "excerpt",
          file: server("src/runtime.ts"),
          pick: { start: "if (!conversation.handles.includes(input.handle))", until: 'if (spec.kind === "inform" && pending)' },
          lang: "ts",
        },
        { kind: "h", text: "One turn at a time" },
        {
          kind: "p",
          text: "Each request takes a **lease** on its conversation, with a fencing token. A second request for the same conversation is turned away while the lease is live, and a request that was slow enough to be overtaken has its final save rejected, so it can't overwrite the newer turn. A crashed process just lets its lease expire.",
        },
      ],
      takeaways: [
        "Pending keeps toolUseId, handle, digest and sibling results; the digest ships with the answer.",
        "A click is checked for handle, frozen state, declared action, valid value and the awaited surface before its handler runs.",
        "Leases with fencing tokens allow one turn per conversation and reject saves from overtaken requests.",
      ],
      check: {
        question: "Why does the pending record keep the digest?",
        options: [
          "The elicit tool never got a tool_result, so the model hasn't seen the digest yet",
          "To render the component again after a reload",
          "So the browser can show it in the tool row",
        ],
        answer: 0,
        why: "A display tool's digest goes out immediately as its result. An elicit tool's result is the answer, so its digest waits and goes out with it.",
      },
    },
  ],
};
