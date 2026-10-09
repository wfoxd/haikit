# The default UI

`@haikit/client` ships a ready-made chat UI. `mountChat` builds it and
`hai.css` styles it. This guide covers how to put it on a page, what each part
does, how to theme it, how to style your own surfaces to match, and when to
build your own instead.

It is a convenience, not the API. Everything it does is built on two
lower-level pieces, `createChat` and `renderTranscript`. When it stops fitting,
use those to [build your own layout](#building-your-own-layout).

```
┌────────────────────────────────────────────────────────────────────────┐
│ title │ subtitle          ● model    + New chat    Context  ~67 tok    │
├──────────────────────────────────────────┬─────────────────────────────┤
│                     ┌──────────────────┐ │ Model context debug drawer  │
│                     │ your message     │ │                             │
│                     └──────────────────┘ │ 97% kept out of context     │
│ The assistant's reply.                   │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ┌──────────────────────────────────────┐ │ ■ model context     ~67 tok │
│ │ ● search_flights {…}  awaiting you › │ │ ■ browser payload ~1958 tok │
│ ├──────────────────────────────────────┤ │                             │
│ │ your surface                         │ │ USER                        │
│ └──────────────────────────────────────┘ │ find me flights to Tokyo…   │
│ ● Waiting on your selection above        │ ASSISTANT                   │
│ ┌──────────────────────────────────┬───┐ │ tool_use · search_flights   │
│ │ pick an option above — or type…  │ ↑ │ │                             │
│ └──────────────────────────────────┴───┘ │                             │
└──────────────────────────────────────────┴─────────────────────────────┘
```

## Set it up

You need three things on the page: `hai.css`, `mountChat`, and a registry of
your surface components. The server side is the same whichever way you build
the page; [the tutorial](tutorial.md) walks through it.

### With a bundler

Import the stylesheet and the shell as modules. This is what
[`examples/hello-react`](../examples/hello-react) does with Vite:

```js
import "@haikit/client/hai.css";
import "./styles.css"; // your surfaces' styles, and any token overrides
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.js";

mountChat({
  root: document.querySelector("#app"),
  registry,
  title: "flights",
  suggestions: ["find me flights to Tokyo next Friday"],
});
```

### Without a bundler

The package ships plain ES modules, not a bundle. Serve its `src/` directory
under a URL prefix and load it straight from the page. Ask Node where the
package is rather than guessing a path into `node_modules`:

```ts
const CLIENT = path.dirname(fileURLToPath(import.meta.resolve("@haikit/client")));
// serve CLIENT under /hai-client/, and check each resolved path stays inside it
```

Then the whole page is:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>flights</title>
    <link rel="stylesheet" href="/hai-client/hai.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      import { mountChat } from "/hai-client/app.js";
      import { registry } from "./components.js";

      mountChat({ root: document.querySelector("#app"), registry, title: "flights" });
    </script>
  </body>
</html>
```

[`examples/hello`](../examples/hello) and [`examples/flights`](../examples/flights)
are built this way.

### The registry

The registry maps each surface's name to a component. A component is an object
with a `mount(element, props, ctx)` function. A surface the registry doesn't
name is never improvised: it shows an "unknown component" card instead.

```js
export const registry = {
  colour_picker: {
    mount(el, props, ctx) {
      for (const colour of props.colours) {
        const row = document.createElement("button");
        row.className = "picker-row";
        row.textContent = colour.name; // payloads are untrusted: text, never HTML
        row.disabled = ctx.mode !== "elicit" || ctx.state !== "live";
        row.onclick = () => ctx.send("choose", colour.id);
        el.append(row);
      }
      return {
        // the user answered: this question can't be answered again
        freeze() {
          for (const row of el.children) row.disabled = true;
        },
      };
    },
  },
};
```

`ctx.send(action, value)` is the component's only way to reach the server, and
it names an action the surface's contract declares. `mount` may return
`freeze`, `expire` and `unmount`; [the client's
README](../packages/client/README.md#surface-lifecycle) says when each is
called. To write components in React, see
[`@haikit/react`](../packages/react).

## Options

| Option | Default | |
| --- | --- | --- |
| `root` | (required) | The element the shell replaces the contents of. |
| `registry` | (required) | Your surface components, by name. |
| `endpoint` | `"/hai"` | Where the server's routes are mounted. |
| `title` | `"HaiKIT"` | Shown in the header, beside the logo. |
| `subtitle` | none | Shown after the title. Hidden on narrow screens. |
| `emptyText` | none | A line of text for an empty conversation. |
| `suggestions` | `[]` | Starter prompts for an empty conversation. Clicking one sends it. |
| `placeholder` | `"message…"` | The message box's placeholder. |
| `inspector` | `true` | Include the model context debug drawer. |
| `theme` | follows the system | `"light"` or `"dark"` pins the colour scheme. See [Theming](#theming). |

`mountChat` returns the chat, so you can call `chat.send(text)`,
`chat.reset()` or `chat.close()` yourself.

The shell is built to be the page. It fills the viewport, and `hai.css` removes
the body's margin while one is on the page. A page without a favicon of its own
gets the haikit one while a chat is open; add a `<link rel="icon">` to use
yours.

## What's on the screen

### Header

From left to right:
- **Logo, title and subtitle.**
- **Model badge:** the model the server reports, once it has reported one.
- **New chat:** calls `chat.reset()` and starts a new conversation. If the
  server has an init tool, it runs again straight away. The button is enabled
  once there's something to start over from: the user has sent something or
  answered a question, the server has opened a conversation, or the
  conversation is out of date.
- **Context:** opens the [model context debug
  drawer](#the-model-context-debug-drawer). It shows how many tokens the
  model holds, such as `~67 tok`, even while the drawer is closed.

Below 900px the buttons show only their icons, and below 600px the model badge
is hidden. Screen readers still announce each button's name.

### The conversation

Messages sit in a centred column, `--hai-column` wide (780px by default). The
column follows new content as it streams in. If you scroll up, it keeps your
place until you scroll back down.

- **Your messages** are right-aligned bubbles.
- **Replies** are plain text. Each paragraph takes its own text direction, so
  a reply can mix left-to-right and right-to-left scripts.
- **Tool rows** show each tool call, with its surface joined underneath. See
  below.
- **Answers given in a surface** show as a line with an arrow icon. That line
  is what the model received as the tool's result.
- **Notices** from `hai.notify` show as a card labelled `notice · <name>`,
  drawn by the component you register for that name in `mountChat`'s
  `notices`. One that names a surface sits right under it. Screen readers
  announce it as it arrives. A wake notice's reply streams in after it, as
  any reply does, and the message box waits for it to finish.
- **Errors** show as a red notice.
- **An out-of-date conversation** shows a notice with a **Start a new
  conversation** button. Its surfaces are greyed out and stop responding. This
  happens once a surface passes its freshness window, so a tab left open
  doesn't look live until a click is refused.

While a surface's props are still arriving, its card shows a loading
placeholder.

### Tool rows

Each tool call gets a row saying where it stands:

| The row says | When |
| --- | --- |
| `running…` | The tool is executing. |
| `Checking fare sources · 2/4` | The tool is executing and has reported progress with `ctx.progress`. A thin bar along the bottom of the row fills once it gives a `total`. |
| `awaiting you` | The turn is parked on the question this tool asked. The row and its surface are outlined in amber. |
| `resolved` | The question was answered, or the user typed something else instead. |
| `out of date` | The conversation expired before the question was answered. |
| `12 ms` | The tool finished. |
| `failed · 40 ms` | The tool threw an error. |

Click a row to expand it. It shows the call's **input** and the
**`tool_result`**, which is everything the model received from that call. A
surface can hold hundreds of rows while the model holds only that one result.

### Status line and message box

Above the message box, a status line says **Thinking** while the model is
replying. It says **Waiting on your selection above** while a question is
waiting.

- **Enter** sends, and **Shift+Enter** starts a new line. Enter doesn't send
  while you're still composing text in an input method editor.
- **The box grows** as you type, up to a limit, then scrolls.
- **While a question waits**, you can still type. Sending a message closes
  the question: the model is told the user didn't pick an option, and gets
  what they typed instead. The row says `resolved`.
- **If a message can't be sent** because the conversation went out of date
  first, the text is put back in the box.

### The empty conversation

Before the user has sent anything or answered a question, the transcript
shows `emptyText` and the `suggestions`. On an empty page they're centred
under the logo. If your server's init tool has already shown something, such
as a welcome surface, they sit underneath it instead. They disappear once the
user sends a message or answers a question.

## The model context debug drawer

The drawer shows what the model actually receives. Keep it while you
develop: it's the quickest way to see that the browser got the data and the
model got only a summary.

- **The headline:** the share of the payload kept out of the model's context,
  such as `97% kept out of context`.
- **A bar and two counts:** tokens in the model's context, and tokens sent
  only to the browser.
- **Every message the model receives:** user and assistant messages, each
  `tool_use` with its input, and each `tool_result`. The numbers stay pinned
  at the top while the messages scroll underneath.

How it behaves:
- **It starts closed.** **Context** in the header opens it, and it slides in
  from the right.
- **On a wide screen** (900px and up) the conversation moves over to make room
  for it.
- **On a narrow screen** it opens over the conversation. The conversation
  behind it is dimmed and can't be reached with the keyboard. Tapping it
  closes the drawer.
- **Escape** closes it from anywhere in the shell, unless something else, such
  as one of your surfaces, used the key first. So does its close button.
  Focus goes back to **Context** if it was inside the drawer.
- **It remembers being open.** After a reload it opens again, on a wide screen
  only. The setting is kept in `localStorage` under `hai:debug-drawer`.

To leave it out, pass `inspector: false`.

## Theming

The UI follows the system's light or dark setting.

### Pinning a scheme

To pin it, set `data-hai-theme` on the `<html>` element, or pass `theme` to
`mountChat`:

```html
<html lang="en" data-hai-theme="dark">
```

```js
mountChat({ root, registry, theme: "light" });
```

The pin goes on `<html>` rather than on the chat's own element because the
colour variables are defined there. Vite's CSS minifier, for one, resolves
them there.

With `theme`, `mountChat` sets the attribute and gives the page back its
previous value when the chat closes. If several chats on a page each set a
theme, the newest one still open wins. A value your page sets itself in the
meantime is left alone.

### Changing colours

Every colour is a CSS variable, set at zero specificity, so a plain `:root`
rule in your own stylesheet overrides it. One value applies to both schemes:

```css
:root { --hai-radius: 8px; }
```

To give a colour one value per scheme, use `light-dark()`. Put a plain dark
value first, for browsers that don't support `light-dark()`:

```css
:root { --hai-accent: #b07cff; }
@supports (color: light-dark(#000, #fff)) {
  :root { --hai-accent: light-dark(#6d28d9, #b07cff); }
}
```

Without that fallback, those browsers would get no colour at all for the
variable. In them, `hai.css` uses its dark colours and a pinned scheme has no
effect. Plain overrides like the one above still apply, so a page can still
give those browsers light colours itself.

### The variables

| Variable | Used for |
| --- | --- |
| `--hai-bg` | the page |
| `--hai-panel` | cards: surfaces, the header, the message box |
| `--hai-panel-2` | secondary panels: tool rows, the drawer |
| `--hai-fg` `--hai-dim` | text, and secondary text |
| `--hai-line` `--hai-line-soft` | borders, and dividers between rows |
| `--hai-accent` `--hai-on-accent` | the accent, and text drawn on it |
| `--hai-good` `--hai-warn` `--hai-bad` | success, waiting and error colours |
| `--hai-accent-soft` `--hai-good-soft` `--hai-warn-soft` `--hai-bad-soft` | pale tints of those, for backgrounds |
| `--hai-hover` `--hai-selected` | a hovered row, and a picked row, for your surfaces |
| `--hai-user-bg` | your message bubbles |
| `--hai-code-bg` | the input and result blocks in an expanded tool row |
| `--hai-shadow` | the shadow under cards |
| `--hai-logo-ink` `--hai-logo-paper` `--hai-logo-hot` | the haikit logo: its body, its inner bars, and its orange |
| `--hai-radius` | corner radius |
| `--hai-sans` `--hai-mono` | fonts |
| `--hai-column` | the conversation's width |
| `--hai-inspector-width` | the drawer's width |

The tints, `--hai-hover`, `--hai-selected` and `--hai-line-soft`, are mixed
from the other colours. Override a colour and its tints follow.

## Styling your surfaces

`hai.css` styles only what the framework renders: the shell, the transcript,
tool rows, the card each surface sits in, and the drawer. It never styles
the inside of a surface. Your components choose their own class names, and
your stylesheet owns them.

Build those styles from the variables and your surfaces follow the scheme,
and any overrides, with no extra work:

```css
.picker-row {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--hai-line-soft);
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.picker-row:hover:not(:disabled) { background: var(--hai-hover); }
.picker-row.picked { background: var(--hai-selected); }
.picker-row:disabled { cursor: default; }
.chip.on { background: var(--hai-accent); color: var(--hai-on-accent); }
```

Avoid hard-coded colours such as `#1a222c`: they look right in one scheme and
wrong in the other.

These hooks are stable if you need to style around a surface:

| Selector | Matches |
| --- | --- |
| `.hai-surface` | the card a surface mounts into |
| `.hai-surface[data-component="colour_picker"]` | one component's cards |
| `.hai-surface[data-handle="…"]` | one surface |
| `.hai-surface[data-expired]` | a surface in an out-of-date conversation |
| `.hai-tool` | a tool row |
| `.hai-tool.hai-status-awaiting` | a tool row by status: also `running`, `resolved`, `expired`, `ok` and `error` |
| `.hai-tbar` | a running tool's progress bar. Its fill is `--hai-progress`, a percentage |
| `.hai-notice` | the card a notice mounts into. Also `.hai-notice-label` and `.hai-notice-body` |
| `.hai-notice[data-notice="hold_confirmed"]` | one notice's cards |
| `.hai-status[data-status="awaiting"]` | the status line by conversation status: also `streaming` and `idle` |

## Lifecycle

- **Each surface mounts once.** It keeps its own state, such as a filter, an
  expanded row or a React tree, for as long as the conversation goes on.
- **New chat**, or `chat.reset()`, unmounts every surface and starts a new
  conversation.
- **`chat.close()`** ends the chat for good. Anything still open is aborted,
  every surface is unmounted, and `mountChat` removes its shell. It also lets
  go of everything else it set up, including a theme it pinned.

## Building your own layout

When the default layout stops fitting, build your own from the same pieces.
`renderTranscript` draws the conversation into any element, and the block
styles in `hai.css` still apply there. `renderInspector` draws what the drawer
shows into any element.

```js
import { createChat } from "@haikit/client";
import { renderTranscript, closeTranscript } from "@haikit/client/transcript.js";
import { renderInspector } from "@haikit/client/app.js";

const chat = createChat({ endpoint: "/hai", registry });

chat.subscribe((state, event) => {
  if (event.type === "closed") return closeTranscript(transcriptEl);
  if (event.type === "reset") chat.start(); // run the server's init tool again
  renderTranscript(transcriptEl, chat);
  renderInspector(contextEl, state.context);
});

chat.start(); // run the server's init tool before anything is typed
form.onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value;
  if (!text.trim()) return;
  input.value = "";
  // false: it never reached the server, as when the conversation went out of
  // date first. Give the text back, unless something new has been typed.
  if (!(await chat.send(text)) && !input.value) input.value = text;
};
```

Call `renderTranscript` on every event. It only redraws what changed, so
surfaces still mount once. Things `mountChat` did for you that you now do
yourself:
- `chat.start()` when the page opens, and again after `chat.reset()`;
- a message box, and disabling it once `state.expired` is set;
- putting a message back in the box when `chat.send()` resolves `false`;
- a status line from `state.status`;
- `closeTranscript(element)` when you take a transcript off the page.

The transcript itself still shows the out-of-date notice, and its button still
calls `chat.reset()`.
