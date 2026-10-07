import type { PartDef } from "./types.ts";

/**
 * Part 1: what an elicitation app is, from the outside. No code yet: the
 * learner experiences each idea in this very app before Part 2 shows how it's
 * built.
 */
export const part1: PartDef = {
  n: 1,
  title: "The elicitation app, explained",
  blurb:
    "What it means for a component to be the question, what the model and the browser each receive, and what happens while a turn waits on a person.",
  lessons: [
    {
      id: "1.1",
      title: "Asking in prose doesn't scale",
      minutes: 3,
      summary: "Why an agent that has to ask “which one?” in plain text gets worse the more it knows.",
      blocks: [
        {
          kind: "p",
          text: "Ask an agent to find flights and it fetches 47 of them. Then it has to ask which one you want, and in a plain chat the only way it can ask is in prose.",
        },
        {
          kind: "compare",
          sides: [
            {
              title: "Asking in prose",
              tone: "bad",
              sample: "Here are the top five options:\n1. NH111, $202, 2 stops\n2. AC832, $343, nonstop\n…\nWhich would you like?",
              text: "Forty-two rows are dropped to fit. The five that remain are billed as context on every later turn. And when you answer “the second one”, the model has to work out which row you meant from a list it only half remembers.",
            },
            {
              title: "Asking with a component",
              tone: "good",
              picker: {
                caption: "47 flights, SFO to NRT",
                options: [
                  { id: "NH111", label: "NH111", detail: "$202, 2 stops" },
                  { id: "AC832", label: "AC832", detail: "$343, nonstop" },
                  { id: "UA837", label: "UA837", detail: "$371, nonstop" },
                  { id: "JL897", label: "JL897", detail: "nonstop, fastest" },
                ],
                more: 43,
              },
              text: "All 47 rows go to your browser as a list to choose from. The model receives a few sentences about them. Your click comes back as a row id that has already been validated.",
            },
          ],
        },
        {
          kind: "p",
          text: "An **elicitation app** asks with the interface. The model calls a tool, the tool renders a component, and what you do with that component is your answer. haikit is a framework for building them.",
        },
        { kind: "h", text: "You're using one now" },
        {
          kind: "p",
          text: "This introduction is a haikit app. The lesson you're reading was rendered by a tool called `show_lesson`. The model that called it received a short digest; the full text came straight to your browser and never entered its context.",
        },
        {
          kind: "note",
          tone: "look",
          text: "**Context**, at the top right, opens the model context drawer: everything the model has received so far. The numbers at its top compare that with what your browser holds. Keep it open as you go through the course.",
        },
      ],
      takeaways: [
        "Asking in prose drops rows, costs tokens on every later turn, and turns the answer into a parsing problem.",
        "An elicitation app asks with a component, and the user's interaction is the answer.",
        "The model gets a short digest; the browser gets the full data.",
      ],
      check: {
        question: "In a plain chat, why is “the second one” a risky answer for the model to handle?",
        options: [
          "It has to match those words to rows it may only half remember",
          "The Messages API rejects ordinal numbers in user messages",
          "Short replies are dropped before they reach the model",
        ],
        answer: 0,
        why: "The model listed the rows in prose and has to map your words back onto them. A component sends back the row id itself, already validated.",
      },
    },

    {
      id: "1.2",
      title: "The UI is the question",
      minutes: 4,
      summary: "How a tool waits for a person: the turn parks, and the click becomes the tool result.",
      blocks: [
        {
          kind: "p",
          text: "Here's the move that makes elicitation work. The model calls a tool. The tool renders a component and deliberately sends **no** `tool_result`. The conversation parks, the HTTP response closes, and nothing is held open.",
        },
        {
          kind: "p",
          text: "When the user clicks, that click becomes the tool result, and the same turn resumes. From the model's side, a tool simply took a while to return. 200 milliseconds and three days look exactly the same.",
        },
        {
          kind: "sequence",
          title: "One elicit round trip",
          steps: [
            {
              from: "browser",
              to: "server",
              label: "“find me flights”",
              note: "The browser posts the message. The server loads the conversation and takes its turn lease, so no other request can run a turn on it at the same time.",
            },
            {
              from: "server",
              to: "model",
              label: "messages[]",
              tone: "model",
              note: "The model receives the history and decides to call `search_flights`.",
            },
            {
              from: "model",
              to: "server",
              label: "tool_use",
              tone: "model",
              note: "The tool runs and calls `ctx.render(flightTable, props, { mode: \"elicit\" })`.",
            },
            {
              from: "server",
              to: "browser",
              label: "ui_open, ui_props",
              tone: "ui",
              note: "All 47 rows stream to the browser over server-sent events. They never enter the model's context.",
            },
            {
              from: "server",
              to: "server",
              label: "status: awaiting",
              tone: "park",
              note: "No `tool_result` is sent. The server saves what it's waiting for and closes the response. The turn is parked.",
            },
            {
              from: "browser",
              to: "server",
              label: "{ handle, action, value }",
              tone: "ui",
              note: "Minutes or days later, the user clicks a row. The browser sends only which surface, which declared action, and the value.",
            },
            {
              from: "server",
              to: "model",
              label: "tool_result",
              tone: "model",
              note: "The digest and the user's selection become the missing tool result, and the same turn resumes.",
            },
            {
              from: "server",
              to: "browser",
              label: "text_delta, ui_state",
              note: "The model's reply streams back. The surface is frozen: it has answered its question and can't be answered again.",
            },
          ],
        },
        {
          kind: "note",
          tone: "tip",
          text: "Step through it with the buttons or the arrow keys. The stepping happens only in your browser: this lesson's contract declares no action for it, so those clicks have no way to reach the server. Lesson 1.4 explains why that matters.",
        },
        { kind: "h", text: "You're about to do it" },
        {
          kind: "p",
          text: "Below this lesson is a checkpoint question, rendered by `ask_checkpoint` in elicit mode. Right now the turn is parked on it. Its tool row says `awaiting you`, the status line above the message box says so too, and the context drawer ends with a `tool_use` that has no result yet.",
        },
        {
          kind: "p",
          text: "Answer it and watch the context drawer: your click arrives as the missing `tool_result`, the row changes to `resolved`, and the guide picks up where it stopped.",
        },
      ],
      takeaways: [
        "An elicit tool emits a tool_use and sends no tool_result, so the conversation parks with status awaiting.",
        "Nothing is held open while it waits: the Messages API is stateless, so waiting costs nothing.",
        "The click becomes the tool result and the same turn resumes.",
      ],
      check: {
        question: "While a turn is parked on an elicit surface, what is the server holding open?",
        options: [
          "A streaming connection to the model",
          "Nothing: the conversation is saved as awaiting and the response is closed",
          "A WebSocket to the browser",
        ],
        answer: 1,
        why: "The Messages API is stateless and doesn't care how long a tool takes, so the server only records what it's waiting for. The request that carries the click picks the turn back up.",
      },
    },

    {
      id: "1.3",
      title: "Two channels from one tool call",
      minutes: 4,
      summary: "The digest goes to the model, the payload goes to the browser, and a handle connects them.",
      blocks: [
        {
          kind: "p",
          text: "Every tool that renders a component produces two outputs. A **digest**: a short text that becomes the `tool_result`, which is all the model receives. And a **payload**: the full props, streamed to the browser to draw the component.",
        },
        {
          kind: "diagram",
          text:
            "                    ┌─ model channel ──▶ tool_result (digest) ──▶ model\n" +
            "tool executes ──────┤\n" +
            "                    └─ UI channel ─────▶ SSE ──▶ registry ──▶ component\n" +
            "                                                      ▲\n" +
            "                                  user interacts ─────┘\n" +
            "                                        │\n" +
            "                                        ▼\n" +
            "                            back into the turn as a tool_result",
          caption: "One execution, two outputs. The model never sees the payload.",
        },
        {
          kind: "p",
          text: "Every digest ends with a **handle**, such as `ui_03`. The handle points at the stored payload. The model can't read the payload directly, but it can ask about it by handle, which is lesson 1.5.",
        },
        { kind: "h", text: "The digest is the hard part" },
        {
          kind: "compare",
          sides: [
            {
              title: "A lazy digest",
              tone: "bad",
              sample: "47 flights, $202–$829. Rendered as ui_01.",
              text: "Invites the model to state facts it never received, such as “that's the cheapest nonstop”, about rows it has never seen.",
            },
            {
              title: "A useful digest",
              tone: "good",
              sample:
                "47 flights SFO→NRT, $202–$829. Cheapest: NH111 $202 (2 stops).\nCheapest nonstop: AC832 $343, 08:38, 11h23m. Fastest: JL897 10h33m.\n11 nonstop / 36 with stops. Rendered as ui_01.",
              text: "Twice as long and still tiny. It precomputes what the next turn or two will plausibly need, so every claim the model makes about the results is grounded.",
            },
          ],
        },
        {
          kind: "p",
          text: "That's why haikit makes `digest` a required part of every surface. Leaving it out doesn't compile, which is lesson 2.7.",
        },
        {
          kind: "note",
          tone: "look",
          text: "Expand the `show_lesson` row above this lesson. It shows the call's input and the tool result this lesson produced: its digest, and nothing else. The recap at the bottom of every lesson is that same digest, so you can always see what the model was told.",
        },
      ],
      takeaways: [
        "One render, two outputs: a digest on the model channel and the payload on the UI channel.",
        "The handle in the digest points at the stored payload.",
        "A good digest precomputes what the next turn or two will need, so the model never describes rows it hasn't seen.",
      ],
      check: {
        question:
          "A digest says “47 flights, $202–$829.” The user asks whether the cheapest flight is nonstop. What should a well-behaved model do?",
        options: [
          "Say yes, since cheap flights are usually nonstop",
          "Look it up through the handle, or say it doesn't know",
          "Ask the user to paste the table into the chat",
        ],
        answer: 1,
        why: "The digest doesn't contain that fact, so any direct answer would be invented. The handle exists so the model can fetch exactly the rows it needs.",
      },
    },

    {
      id: "1.4",
      title: "Display or elicit, resolve or inform",
      minutes: 4,
      summary: "The small vocabulary that decides whether a component blocks the turn, and what a click on it means.",
      blocks: [
        { kind: "p", text: "The tool that renders a surface chooses one of two **modes**:" },
        {
          kind: "table",
          head: ["Mode", "The turn", "Good for"],
          rows: [
            ["`display`", "Keeps going. The digest is the tool result, right away.", "Results, cards, charts: things the turn produced"],
            ["`elicit`", "Parks until the user answers.", "Pickers, forms, approvals: questions"],
          ],
        },
        { kind: "p", text: "A surface also declares its **actions**, and each action is one of two kinds:" },
        {
          kind: "table",
          head: ["Action kind", "What a click does"],
          rows: [
            ["`resolve`", "Answers the parked question. The click becomes the tool result and the turn resumes."],
            ["`inform`", "Adds a line to the conversation without having blocked anything, such as “copied the Hebrew greeting”."],
          ],
        },
        {
          kind: "p",
          text: "Two rules follow. An elicit surface has to declare a `resolve` action, or nothing could ever unpark the turn, so haikit won't compile one that doesn't. And one model reply can ask only one question: the turn waits on the first elicit surface, and a second one in the same reply is refused before it's shown.",
        },
        { kind: "h", text: "Undeclared means local" },
        {
          kind: "p",
          text: "Anything a component does that its contract doesn't declare stays in the browser. Sorting a table, opening a tab, stepping through the diagram in lesson 1.2: none of it can reach the server, because there's no channel for it. The list of declared actions is the complete allowlist.",
        },
        {
          kind: "p",
          text: "This is also the defence against injected content. The browser sends `{ handle, action, value }` and nothing else. It can't name a tool, a handler or a target, so text in a payload can never wire a button to `delete_account`.",
        },
        {
          kind: "note",
          tone: "look",
          text: "This introduction uses both modes in one reply. Each lesson is a `display` surface, so the guide kept going after rendering it and asked the checkpoint question below, which is `elicit`.",
        },
      ],
      takeaways: [
        "display renders and the turn continues; elicit parks the turn until a resolve action answers it.",
        "resolve answers the question; inform adds context without blocking.",
        "Undeclared interactions are local by construction, and the browser can never name what happens next.",
      ],
      check: {
        question:
          "You want a button on a results card that lets the model know “the user copied this”, without blocking anything. What do you use?",
        options: [
          "An elicit surface with a resolve action",
          "A display surface with an inform action",
          "No declaration: the component calls the tool directly",
        ],
        answer: 1,
        why: "Nothing is being asked, so the surface is display, and an inform action adds the fact to the conversation without blocking. Components can never call tools; they can only send declared actions.",
      },
    },

    {
      id: "1.5",
      title: "Following the handle: query_ui and cap",
      minutes: 3,
      summary: "How the model reads more of a payload than its digest, without pulling the payload into context.",
      blocks: [
        {
          kind: "p",
          text: "Sooner or later the user asks something the digest doesn't cover, like “which ones are nonstop and under $400?” The model then calls `query_ui` with the handle, a query name and arguments:",
        },
        {
          kind: "code",
          lang: "text",
          code: 'query_ui({ handle: "ui_01", query: "filter", args: { maxStops: 0, maxPrice: 400 } })',
        },
        {
          kind: "p",
          text: "Nobody writes `query_ui`. haikit derives it from the queries your surfaces declare, so it always matches the surfaces that exist. Each query is a named accessor over the stored payload; there's no way to read the raw payload.",
        },
        { kind: "h", text: "Every answer is capped" },
        {
          kind: "p",
          text: "A filter that matches all 47 rows and returns all 47 would undo the whole design. So the only way to build a query's return value is to call `cap()`, which limits the rows by count and by length, and says what it left out:",
        },
        {
          kind: "code",
          lang: "text",
          code: "11 of 47 match. 8 shown, 3 omitted:\nAC832 Air Canada $343 nonstop 08:38 11h23m\nUA837 United $371 nonstop 11:05 11h05m\n…",
        },
        {
          kind: "p",
          text: "Saying what was omitted matters as much as the limit. Silent truncation turns a cost problem into a correctness problem: the model would confidently report eight matches when there are eleven.",
        },
        {
          kind: "note",
          tone: "tip",
          text: "Try it after the checkpoint: type “what is a handle?”. The guide looks the term up in this introduction's glossary with `query_ui`, and the tool row shows the capped answer. Typing while a question is waiting closes that question, as lesson 1.6 explains, so answer first. You can bring a checkpoint back with “retry”.",
        },
      ],
      takeaways: [
        "query_ui is derived from the queries your surfaces declare; the model follows a handle through it.",
        "A query can only return what cap() builds: limited, and honest about what it left out.",
      ],
      check: {
        question: "Why does cap() say “8 shown, 3 omitted” instead of just returning eight rows?",
        options: [
          "So the model knows the answer is partial and doesn't claim there are only eight",
          "Because the Messages API requires a row count in tool results",
          "So the browser can draw a pagination control",
        ],
        answer: 0,
        why: "Silent truncation makes the model confidently wrong. The header tells it what it didn't see.",
      },
    },

    {
      id: "1.6",
      title: "The life of a parked turn",
      minutes: 4,
      summary: "What happens when the user types instead of clicking, reloads the page, or comes back days later.",
      blocks: [
        {
          kind: "p",
          text: "While a turn is parked, the conversation's history ends with a `tool_use` that has no `tool_result`. That history is invalid to send to the model, and the status `awaiting` is the only state where it's allowed. Everything else about parked turns follows from that.",
        },
        { kind: "h", text: "What the server keeps" },
        {
          kind: "table",
          head: ["Field", "Why it's kept"],
          rows: [
            ["`toolUseId`", "Which tool_use the answer belongs to"],
            ["`handle`", "Which surface's click counts, so not just any click resolves the turn"],
            ["`digest`", "An elicit tool never got a tool_result, so its digest hasn't reached the model yet. It goes out with the answer."],
            ["`results`", "Results of other tool calls from the same reply. The API takes a batch of results all at once or not at all."],
          ],
        },
        {
          kind: "p",
          text: "You can see that last row in this introduction. The guide calls `show_lesson` and `ask_checkpoint` in one reply. The lesson's result is held until you answer the checkpoint, and then both go to the model together.",
        },
        { kind: "h", text: "Three ways a parked turn ends" },
        {
          kind: "list",
          items: [
            "**The user clicks.** The resolve action's handler turns the click into a label. The digest plus the label become the tool result, and the surface freezes.",
            "**The user types instead.** The question is closed honestly: its tool result says the user didn't choose and quotes what they typed. The surface freezes and the message is answered as usual.",
            "**Nobody does anything.** Nothing is running. Reload the page, or come back next week with a durable store, and the question is still waiting.",
          ],
        },
        { kind: "h", text: "When the data goes stale" },
        {
          kind: "p",
          text: "Some answers expire. A surface that shows fares can declare `staleAfterMs`. Once any surface in a conversation is past its window, every further request is refused before the model runs, and the user is offered a new conversation. A click on yesterday's fare never reaches the model.",
        },
        {
          kind: "note",
          tone: "warn",
          text: "haikit's development store keeps parked turns in memory, so a restart forgets them. Production apps use a durable store such as `@haikit/postgres`. This introduction switches to it when it's given a database.",
        },
      ],
      takeaways: [
        "awaiting is the only state where a history ending in an unanswered tool_use is allowed.",
        "The pending record keeps the tool_use id, the handle, the digest and any sibling results.",
        "A click resolves the question, typing closes it, and a freshness window can close the whole conversation.",
      ],
      check: {
        question: "A learner types “skip this” while a checkpoint is waiting. What does the model receive for the checkpoint's tool_use?",
        options: [
          "Nothing: the tool_use is removed from the history",
          "A tool result saying the user didn't choose, quoting what they typed",
          "An error, and the conversation has to start over",
        ],
        answer: 1,
        why: "Every tool_use needs a result, so haikit closes the question with its digest plus “User did not select; they said: …”, freezes the surface, and carries on.",
      },
    },
  ],
};
