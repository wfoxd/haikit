# The default UI

`@haikit/client` ships a default chat UI: `mountChat` builds a whole page
around a chat, `renderTranscript` draws a chat's transcript into any element,
`renderInspector` draws the model context debug drawer, and `hai.css` styles
what they render. They're conveniences built on `createChat` (see
[The browser client](client.md)). Dropping to `createChat` and your own
rendering when they stop fitting is the expected path. The
[default UI guide](../default-ui.md) walks through the same ground as a
guide; this page is the exact reference.

Exported by `@haikit/client/app.js`: `mountChat`, `MountChatOptions`,
`renderInspector`. By `@haikit/client/transcript.js`: `renderTranscript`,
`TranscriptOptions`, `DockRequest`, `closeTranscript`, `h`. And two
stylesheets: `@haikit/client/hai.css`, and `@haikit/client/tailwind.css` for an
app built with Tailwind CSS v4.

Checked against `@haikit/*` 0.20.0. Source: `packages/client/src/app.js`,
`packages/client/src/transcript.js` and their `.d.ts` files,
`packages/client/src/hai.css` (built from `packages/client/styles/`) and
`packages/client/src/tailwind.css`.

- [`mountChat`](#mountchat), [`MountChatOptions`](#mountchatoptions)
- [The model context debug drawer](#the-model-context-debug-drawer):
  `renderInspector`
- [The dock](#the-dock)
- [`renderTranscript`](#rendertranscript), [`TranscriptOptions`](#transcriptoptions),
  [`closeTranscript`](#closetranscript)
- [`h`](#h)
- [`hai.css`](#haicss): the `--hai-*` tokens
- [`tailwind.css`](#tailwindcss): the tokens as Tailwind theme values

## `mountChat`

```ts
function mountChat(options: MountChatOptions): Chat;
```

Builds the chat page inside `options.root`, and returns its `Chat`.
(`MountChatOptions` is exported as a type only.)

```js
import { mountChat } from "@haikit/client/app.js";
import { registry } from "./components.js";

mountChat({ root: document.querySelector("#app"), registry, suggestions: ["Say hello"] });
```

**What it does, in order:**

1. Makes a chat with `createChat({ endpoint, registry, notices, signals,
   eventsFallbackMs, pollHoldMs })`. Options left out get `createChat`'s
   defaults.
2. Pins the colour scheme, if `theme` is set (see [Themes](#themes)).
3. Adds HaiKIT's icon as the page's favicon, if the page has no link whose
   `rel` includes `icon` (such as `shortcut icon`) when the first chat
   opens. Every chat on the page shares it, and the
   last one to close removes it.
4. Builds the shell, and replaces everything in `root` with it. The shell
   fills the viewport (`height: 100dvh`): `mountChat` is a whole-page
   layout, and a smaller `root` doesn't constrain it.
5. Renders the transcript, and the empty state (see
   [The empty conversation](#the-empty-conversation)).
6. Calls `chat.start()`, so a server with an init tool runs it before the user
   types. It calls `start()` again after every reset.

**The page it builds:**

| Part | Element and class | What it does |
| --- | --- | --- |
| Shell | `div.hai-shell` | Everything below. A page whose `body` contains one gets `margin: 0` |
| Header | `header.hai-top`, holding `div.hai-brand` and `div.hai-actions` | HaiKIT's mark, `title`, and `subtitle` if set. Under 900 px wide, the subtitle is hidden, and the header buttons' labels are hidden visually but kept for screen readers |
| Model | `span.hai-model` | The model adapter's `id`, from `hello`. Hidden until there is one, and on screens under 600 px wide |
| New chat | `button.hai-btn` | Calls `chat.reset()`. Disabled unless the transcript has a `user` or `interaction` block, the conversation has expired, or the server has given a conversation id. Checked on every event, so it's disabled again after a reset |
| Context | `button.hai-btn.hai-ctx-toggle` | Opens and closes the debug drawer, showing `~<n> tok`, the model's context estimate, with thousands separators. Empty while the estimate is 0. `title`, `aria-controls` and `aria-expanded` are set. Only with `inspector` |
| Main | `div.hai-main` | Holds the chat and the drawer. Has `.has-inspector` with `inspector`, and `.inspector-open` while the drawer is open |
| Chat | `section.hai-chat` | Holds the transcript, the status line and the composer (`div.hai-composer` > `div.hai-composer-box`), and with `dock`, the dock's window. Has `.window-open` while the window is open |
| Transcript | `div.hai-transcript` | Drawn by `renderTranscript` on every event, with `onDock` when `dock` is on |
| Status line | `div.hai-status`, `role="status"` | `Thinking` while streaming, `Waiting on your selection above` while awaiting, or `Waiting on your selection in the dock` while the question is docked, empty otherwise. It changes only when the status does, or where the question is, so a screen reader hears it once per turn. Its `data-status` is the status, or `idle` once the conversation has expired. It's absent until the first event |
| Dock shelf | `div.hai-dock`, `role="toolbar"`, `aria-label="Docked surfaces"` | The composer's first child, above `div.hai-composer-box`. Hidden while nothing is docked. Only with `dock` (see [The dock](#the-dock)) |
| Window | `section.hai-window`, `role="dialog"` | A docked surface, opened. Hidden while none is open. Only with `dock` |
| Message box | `textarea.hai-input`, `aria-label="Message"` | Grows with what's typed, up to 200 px |
| Send | `button.hai-send`, `aria-label="Send"` | Sends the message. An icon only |
| Drawer | `aside.hai-inspector` | The model context debug drawer. Only with `inspector` |

**The message box.**

- **Enter sends,** and Shift+Enter makes a new line. Enter while an input
  method is composing doesn't send.
- **Sending** trims the text, and does nothing if it's empty. It clears the
  box, unless the conversation has expired, when it keeps the text for the
  next conversation. If the message is later turned away (`send` resolves
  `false`), the text is put back, unless something new has been typed.
- **It stays live while a question waits,** with the placeholder `pick an
  option above — or type to override`, or `pick an option in the dock — or
  type to override` while the question is docked. A typed message closes the
  question out.
- **When the conversation has expired,** the box is disabled, with the
  placeholder `start a new conversation to continue`. Otherwise the
  placeholder is `placeholder`.
- **The Send button is disabled** while a turn streams, and once the
  conversation has expired. Enter still sends while a turn streams: the
  message is queued behind the turn.
- **If a request fails,** such as on a network error, the text goes back in
  the message box, unless something new has been typed, and the error is
  logged with `console.error` (`[haikit] the message wasn't sent:`). Nothing
  appears in the transcript. A `start()` that fails is logged the same way
  (`[haikit] the conversation couldn't start:`): the first message starts the
  conversation instead.

### The empty conversation

Until the transcript has a `user` or `interaction` block, it ends with
`div.hai-empty`. The server sends those blocks once it accepts a message or a
click, so the empty state stays while the first message is queued, and stays
if it's turned away. With `emptyText` or `suggestions`, it holds HaiKIT's
mark, `emptyText` as a paragraph, and one `button.hai-suggestion` per
suggestion. Clicking one puts it in the message box, replacing any draft, and
sends it as a typed message would be. Blocks the conversation opened with,
such as an init tool's row or a welcome surface, don't replace it: after
them, the empty state is left-aligned, without the mark.

### Themes

Without `theme`, the page follows the system's light or dark setting, or a
`data-hai-theme` attribute already on the `<html>` element. `theme: "light"`
or `"dark"` sets `data-hai-theme` on the `<html>` element until the chat
closes. With several chats on a page, the pin follows the newest themed chat
still open. When the last closes, the page gets back the pin it had before
the first. A pin the page set itself meanwhile is left alone.

### Closing

`chat.close()` closes the chat (see [The browser client](client.md#close)),
and `mountChat` then removes its shell from the page, stops following its
transcript, releases the theme pin and the favicon, and stops listening for
screen-width changes and, with `dock`, for the composer's size.

## `MountChatOptions`

```ts
interface MountChatOptions {
  root: HTMLElement;
  registry: Registry;
  notices?: NoticeRegistry;
  signals?: SignalRegistry;
  endpoint?: string;
  title?: string;
  subtitle?: string;
  suggestions?: string[];
  inspector?: boolean;
  placeholder?: string;
  emptyText?: string;
  theme?: "light" | "dark";
  dock?: boolean;
  eventsFallbackMs?: number;
  pollHoldMs?: number;
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `root` | required | The element the page is built in. Its children are replaced |
| `registry` | required | Components for surfaces, by surface name |
| `notices` | `{}` | Components for notices, by notice name |
| `signals` | `{}` | Handlers for signals, by signal name |
| `endpoint` | `"/hai"` | Where the server's routes are |
| `title` | `"HaiKIT"` | The header's title |
| `subtitle` | `""` | Text beside the title. Left out when empty |
| `suggestions` | `[]` | Starter messages, as buttons, on the empty conversation |
| `inspector` | `true` | Include the model context debug drawer, and its Context button |
| `placeholder` | `"message…"` | The message box's placeholder |
| `emptyText` | `""` | A line of text on the empty conversation |
| `theme` | follows the system | `"light"` or `"dark"` pins the page's colour scheme. Any other value is ignored |
| `dock` | `true` | Let the reader dock surfaces (see [The dock](#the-dock)). `false` draws surfaces as `renderTranscript` does without `onDock`, and builds no shelf or window |
| `eventsFallbackMs` | `8000` | Passed to `createChat`: how long the events stream may send nothing as it opens before the chat polls (see [The browser client](client.md#polling)) |
| `pollHoldMs` | `15000` | Passed to `createChat`: how long each poll asks the server to hold |

## The model context debug drawer

With `inspector`, the header's Context button opens a drawer that shows the
conversation's history as the model receives it: every message, tool call and
tool result, and how much of the data stayed out of the model's context. The
system prompt and the tool definitions aren't shown, and aren't in the
estimate.

- **It starts closed,** and slides in from the right. Closed, it's `inert`
  and hidden. With `prefers-reduced-motion`, it doesn't slide, and the
  default UI's other animations stop.
- **On a wide screen** (`min-width: 900px`), it opens beside the chat. **On a
  narrow one,** it opens over the chat, and the chat behind it is made
  `inert` until it closes or the screen widens. A tap on the uncovered part
  closes it then.
- **Escape closes it** from anywhere in the shell but the dock's shelf and
  window, which take the key first (see [The dock](#the-dock)), unless
  something there used it first (`defaultPrevented`), such as a surface
  closing a menu of its own. So do its close button and the Context button.
- **Focus:** opening it moves focus to its close button. Closing it from the
  button, with Escape from inside the drawer, or with a tap on the uncovered
  chat returns focus to Context. Escape from outside the drawer leaves focus
  where it is.
- **It remembers being open,** in `localStorage` under `hai:debug-drawer`
  (`"open"` or `"closed"`), and opens again after a reload, but only on a wide
  screen.
- Its accessible name is `Model context debug drawer`. Its visual heading, a
  `div` rather than a heading element, shows the same, with `everything the
  model sees` beneath. The close button is labelled `Close model context
  debug drawer`.

### `renderInspector`

```ts
function renderInspector(
  el: HTMLElement,
  context?: { messages?: any[]; modelTokens?: number; uiTokens?: number },
): void;
```

Draws the drawer's contents into `el`, from a chat's `state.context`.
`mountChat` calls it on every event. Call it yourself to put the same view in
a layout of your own.

- **With no messages and no tokens,** it shows `Nothing yet. Every message,
  tool call and digest the model receives shows up here.`
- **Otherwise, a summary:** when `uiTokens` is above 0, a headline `<p>% kept
  out of context`, where `p` is `1 - modelTokens / (modelTokens + uiTokens)`
  as a whole percentage. Then a bar showing the model's share, and two lines,
  `model context` and `browser payload`, each `~<n> tok`.
- **Then every message,** labelled with its role: a string's text, each
  non-empty text block, each `tool_use` (`tool_use · <name>` and its input as
  JSON), and each `tool_result` (labelled `tool_result`, with its content as
  text: a string as it is, a list of blocks as each block's `text`, or its
  JSON, one per line). Other content blocks, such as thinking, aren't shown.
- Token counts are written with thousands separators.
- **It keeps following the newest message** if `el` was scrolled to within
  40 px of the bottom.

## The dock

With `dock`, the default, the reader can move any surface out of the
transcript onto a shelf above the message box, and open it from there as a
window. `mountChat` passes `onDock` to `renderTranscript`, so every surface is
drawn in a card with a bar: its component's name and, once it has mounted, a
Dock button. Every button the dock adds to a bar is an icon, with no text:
labelled for screen readers, with its name as a `title` tooltip. Dock is
labelled `Dock <component>`, with the title `Dock`.

**Docking moves the surface's element,** and never mounts it again: its
component keeps its state, and answering a question in the window works as it
does in the transcript. An iframe or video inside starts over, as it would
anywhere a page moves one. The card stays in the transcript, in the
surface's place, with `data-docked` and a stub: `<component> is in the dock`,
or `<component> is open in a window` while it's open, and a Put back
button, labelled `Put <component> back`, with the title `Put back`. Focus
moves to Put back. The tool row above it keeps its status, so a
docked question still reads `awaiting you` there.

**The shelf** is the composer's first child, `div.hai-dock`, hidden while
nothing is docked. It shows `docked · <n>` (hidden under 900 px wide, and from
screen readers), then one `button.hai-dock-item` per docked surface, oldest
first. Each item:

- shows the component's name, and has `aria-controls` naming the window and
  `aria-expanded="true"` while its surface is open;
- has `data-status`: `awaiting` for a question that hasn't been answered or
  typed over, `expired` once the conversation has, `live` otherwise. An
  awaiting item has a dot;
- is marked changed while new props have arrived since it was docked or last
  open, until it's opened: a corner mark, `span.hai-dock-changed`;
- is labelled with its name, then `, awaiting you`, `, out of date` and
  `, changed` as they apply.

The shelf ends with Remove all, `button.hai-dock-clear`, an icon labelled
`Remove all from the dock` with the title `Remove all from dock` (see
[Put back and Remove from dock](#put-back-and-remove-from-dock)). Left and
Right arrows, Home and End move along the shelf, Remove all included.

**When the row is full,** the oldest docked surfaces go into a pile at its
end, one at a time until the rest fit. A surface that is awaiting, or open,
never goes in. The pile is a button, `<n> more`, labelled `<n> more docked
surfaces`, with `, <k> changed` and the corner mark when any of them has
changed. It opens a list above the shelf, `stacked · <n> · oldest first`, with
a button per surface; Up and Down arrows, Home and End move along it. The list
is no taller than the room above the shelf in the chat, measured as it opens
(60% of the viewport where nothing is laid out), and scrolls under its
heading. A row that changes while the list is open keeps the reader's focus
on that surface. Picking
one opens its window, and makes it the newest docked, so it comes into the
row. Escape (see below), or a click outside, closes the list, and Escape from
inside the dock returns focus to the pile. The row is measured to decide this, so where nothing is laid out,
nothing goes into the pile. It's measured again when the docked surfaces,
their names, their dots or the open one change, when the composer or the
status line is resized, and when the screen crosses 900 px. An item that goes
into the pile while it has focus passes focus to the pile, and a pile that
goes while it has focus passes it to the item at the row's end.

**The window** shows one docked surface at a time. Clicking an item opens its
surface there, in place of any other, and clicking the open item docks it
again. `section.hai-window` is a `dialog` named by the surface's component,
and has `data-status` as the item does. Its title bar, `div.hai-window-bar`,
shows the name, `· <tool>` for the tool that showed it, a badge (`awaiting
you` or `out of date`), a Remove from dock button, labelled `Remove
<component> from the dock` with the title `Remove from dock`, and a Dock
button, labelled `Dock <component>` with the title `Dock`, that closes the
window.
Opening the window moves focus into it; closing it from its Dock button or
with Escape returns focus to the surface's item, or to the pile if it went in.

### Put back and Remove from dock

**Put back and Remove from dock** return the surface to its card, under its
bar, close its window if it's open, and take its item off the shelf. Focus
moves to the card's Dock button, and the card is scrolled into view. The shelf
goes with the last docked surface.

**Remove all** does the same for every docked surface at once, oldest first,
the open one and those in the pile included, and closes the window and the
pile's list. The shelf goes with them, so focus moves to the message box, or,
once the conversation has expired and the box is disabled, to the expired
notice's `Start a new conversation` button. Nothing is scrolled. The status region says `1 surface is back in the chat`
or `<n> surfaces are back in the chat`.

### Escape and the rest

**Escape,** from inside the window or the shelf, or from anywhere in the
shell while the drawer is closed, closes the pile's list if it's open, and
otherwise the window, unless something used the key first
(`defaultPrevented`). With the drawer open and focus outside the dock,
including in the drawer, Escape is the drawer's: it closes the drawer, and
leaves the list and the window as they are.

- **On a narrow screen** (under 900 px wide), the window is a sheet across the
  chat, from 12% of its height down to the composer. The transcript behind is
  `inert` and dimmed, with the status line, and a tap on it docks the window.
- **A new conversation empties the dock:** its surfaces are gone with the
  old conversation.
- **On an expired conversation,** docked surfaces are `inert` with
  `data-expired`, as they are in the transcript, and still move.
- A visually hidden `role="status"` region says `<component> docked` and
  `<component> is back in the chat`.

## `renderTranscript`

```ts
function renderTranscript(root: HTMLElement, chat: Chat, options?: TranscriptOptions): void;
```

Draws `chat.state.blocks` into `root`. Call it on every event, from a
subscriber. Everything is written with `textContent`, never as HTML, since
tool data is untrusted. `root` must be the element that scrolls (hai.css
gives `.hai-transcript` `overflow-y: auto`): following reads and sets its
scroll position, and listens for its `scroll` events.

```js
const chat = createChat({ registry });
chat.subscribe(() => renderTranscript(log, chat));
```

**Each block keeps its element** while what it shows is unchanged, so a
surface mounts once, and whatever its component holds, such as a filter or a
React tree, lives as long as the surface does. Elements are put in order
without moving any already in place, so none loses its scroll position or
focus, and no iframe or video in one starts over. **Anything else in `root`
is removed,** including nodes the page added after the last render. When a
reset gives the chat a new blocks array, every block gets a new element.

**Following.** While the reader is within 40 px of the bottom, the transcript
keeps the newest content in view, surfaces included, as they mount and as
they grow. Once the reader scrolls up, it keeps their place until they scroll
back down. A new conversation starts at the bottom.

**How each block is drawn:**

| Block | Element | Contents |
| --- | --- | --- |
| `user` | `div.hai-block.hai-user` | The text |
| `assistant` | `div.hai-block.hai-assistant` | The text, as it streams |
| `tool` | `details.hai-block.hai-tool.hai-status-<status>` | A summary row: a status mark, the tool's name, its input as JSON, and its status text. Expanded: the input, pretty-printed, and `→ tool_result — all the model receives` with the result, or `…` until it arrives. An expanded row stays expanded as its status changes |
| `interaction` | `div.hai-block.hai-interaction` | An arrow and the click's label |
| `ui` | `div.hai-surface`, with `data-handle` and `data-component`; with `onDock`, inside a card (see [`TranscriptOptions`](#transcriptoptions)) | The surface, mounted with `chat.mount` once its props arrive. Falsy props (`false`, `0`, `""`) count as not arrived, so such a surface shows the skeleton for good. Before then, `aria-busy="true"` and a skeleton labelled `<surface name> · loading…`. A revision updates `data-handle`, on the card too, and keeps the element |
| `notice` | `div.hai-notice`, `role="status"`, with `data-notice` | A label, `notice · <name>`, and the notice, mounted with `chat.mountNotice` |
| `error` | `div.hai-block.hai-error`, `role="alert"` | The message |
| `expired` | `div.hai-block.hai-expired` | The message, and a `Start a new conversation` button that calls `chat.reset()` |
| any other kind | `div.hai-block` | The block as JSON |

A surface the registry doesn't list shows the client's error card: the
element's class becomes `hai-surface-error`, with `unknown component:
<name>`. An unknown notice's body does the same, with `unknown notice:
<name>`. On an expired conversation, surfaces are `inert`, with
`data-expired`, which hai.css greys out.

**A tool row's status** is the block's, except for a question:

| Status | Text | When |
| --- | --- | --- |
| `running` | `running…` | The call is running |
| `awaiting` | `awaiting you` | Its question is waiting |
| `resolved` | `resolved` | Its question was frozen: answered, or closed out by a typed message |
| `expired` | `out of date` | Its question was waiting when the conversation expired |
| `error` | `failed · <ms> ms` | The init tool failed, or the call was in a reply that stopped for another reason, such as `max_tokens`, and wasn't run |
| `ok` | `<ms> ms` | The call finished. That includes a call that threw: its result says `<name> failed: …`, and any question it showed was withdrawn |

While a call runs and has reported progress, its status text is the progress
instead: the message, the count, or both with ` · ` between. The count is
`<done>/<total>` (`0/<total>` before any `done`), or `<done>` alone without a
total. With a `total` above 0, a `progressbar` along the row's bottom
edge fills. Its accessible name is `<tool> progress`, and its value text
`<message> · <done> of <total>`. Progress updates the row in place, so a
keyboard user on the row keeps their focus.

## `TranscriptOptions`

```ts
interface TranscriptOptions {
  onDock?: (request: DockRequest) => void;
}

interface DockRequest {
  handle: string;
  card: HTMLElement;
  element: HTMLElement;
}
```

(Both are exported as types only.)

**`onDock`** makes surfaces dockable. Each `ui` block is drawn as a card,
`div.hai-dockable` with `data-handle`, holding a bar, `div.hai-surface-bar`,
and the surface's `div.hai-surface`. The bar shows the component's name,
`span.hai-surface-name` (`surface` before the surface is known), and once
the props have arrived a Dock button, an icon labelled `Dock <component>`
with the title `Dock`, which
calls `onDock` with the surface's handle as it is now, its card and its
element. The card stays in the transcript, kept like any block's element;
what goes in it after that is yours. Moving `element` elsewhere keeps its
component mounted, and a revision still reaches it and updates its
`data-handle`. The card has `data-expired` while its surface does, wherever
the surface is. Without `onDock`, a surface is drawn as before, with no card.
`mountChat` passes its dock (see [The dock](#the-dock)).

## `closeTranscript`

```ts
function closeTranscript(root: HTMLElement): void;
```

Stops following a transcript that's going away: its resize observer and
scroll listener let go of `root`. `mountChat` calls it when its chat closes.
A page rendering a transcript itself calls it when it removes one.

## `h`

```ts
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K];
```

Makes an element: `document.createElement(tag)`, with `className` and
`textContent` set when given (`text` may be `""`). The default UI builds
everything with it. It's exported for components that want the same.

## `hai.css`

```html
<link rel="stylesheet" href="/hai-client/hai.css" />
```

That path is where the examples serve the package's `src/` (see
[The browser client: serving it](client.md#serving-it)). With a bundler,
import `@haikit/client/hai.css`. With Tailwind CSS v4, import
[`tailwind.css`](#tailwindcss) instead, which brings this file with it.

It's plain CSS, loaded as it is. In HaiKIT's repository it's built by
`npm run build:css`: the hand-written rules in `packages/client/styles/hai.css`,
followed by any utilities compiled from the default UI's class names. Those
are prefixed `hai:` and sized in pixels, so they can't collide with a page's
own classes, and a page's Tailwind theme or root font size can't resize them.

Styles only what the framework renders: the shell, the transcript's blocks,
the tool rows, the surface container, the drawer and the dock. It doesn't style the
inside of your surfaces: your components use their own class names, and your
stylesheet owns them. They can use the tokens.

### Tokens

Every token is set on `:where(:root)`, at zero specificity, so a plain
`:root` rule in your own stylesheet wins. Colours take one value per scheme
with `light-dark()`, except those that are the same in both:

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--hai-bg` | `#fff3c4` | `#0f1115` | The page |
| `--hai-panel` | `#ffffff` | `#1a1d23` | Cards and the header |
| `--hai-panel-2` | `#fffaf0` | `#15171c` | Secondary panels: settled tool rows, the drawer |
| `--hai-line` | `#0f1115` | `#f3f2ee` | Borders, and the shadow |
| `--hai-fg` | `#0f1115` | `#f3f2ee` | Text |
| `--hai-dim` | `#4d4a42` | `#bdbab1` | Secondary text |
| `--hai-accent` | `#ff5a1f` | `#ff5a1f` | The accent: a running tool, the send and new conversation buttons |
| `--hai-on-accent` | `#0f1115` | `#0f1115` | Text drawn on the accent, and on `--hai-warn` |
| `--hai-good` | `#1fa35a` | `#6ee39a` | Success |
| `--hai-warn` | `#ffd23f` | `#ffd23f` | Waiting on you. A fill: too light for text in the light scheme |
| `--hai-bad` | `#c4262b` | `#ff7a72` | Errors |
| `--hai-user-bg` | `#7cc6ff` | `#23506f` | The user's messages, and a notice's label |
| `--hai-code-bg` | `#f6efdc` | `#0b0c0f` | A tool call's input |
| `--hai-selected` | `#c9f5cf` | `#1d3b2a` | A picked row, for your surfaces too, and a `resolved` badge |
| `--hai-shadow` | `4px 4px 0 var(--hai-line)` | the same | Card shadows |
| `--hai-logo-ink` | `#0f1115` | `#f3f2ee` | HaiKIT's mark |
| `--hai-logo-paper` | `#f3f2ee` | `#0f1115` | HaiKIT's mark |
| `--hai-logo-hot` | `#ff5a1f` | `#ff5a1f` | HaiKIT's mark |

These are mixed from the colours above, where they're declared, so they
follow an override set on `:root` (not one set on an inner element). The
`-soft` tints are solid, mixed in Oklab, so they look the same on the page as
on a card:

| Token | Value |
| --- | --- |
| `--hai-line-soft` | `--hai-line` at 60%: row dividers |
| `--hai-hover` | `--hai-warn` at 35%, or 20% in the dark scheme: row hover, for your surfaces too |
| `--hai-accent-soft` | 25% `--hai-accent` in `--hai-panel` |
| `--hai-good-soft` | 25% `--hai-good` in `--hai-panel`: a tool's result |
| `--hai-warn-soft` | 25% `--hai-warn` in `--hai-panel` |
| `--hai-bad-soft` | 25% `--hai-bad` in `--hai-panel`: a failed row, an error |

And these aren't colours:

| Token | Default | Meaning |
| --- | --- | --- |
| `--hai-radius` | `0` | Corner radius |
| `--hai-sans` | `"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Text |
| `--hai-mono` | `"Space Mono", ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace` | Code, tool rows, the status line |
| `--hai-column` | `780px` | The conversation's width |
| `--hai-inspector-width` | `400px` | The drawer's width |

hai.css doesn't load Space Grotesk or Space Mono. A page that loads them gets
them; otherwise the next face in each list stands in.

**Schemes.** hai.css sets `color-scheme: light dark` on the page root, which
also changes the page's default background, form controls and scrollbars in
dark mode. `data-hai-theme="light"` or `"dark"` on the `<html>` element pins
the page to one scheme, through `color-scheme` at zero specificity, so a
page's own `:root { color-scheme: … }` overrides both. A browser without
`light-dark()` gets the dark values, even with a `light` pin. To override a colour for both schemes, keep a plain value first, for
those browsers:

```css
:root { --hai-accent: #b07cff; }
@supports (color: light-dark(#000, #fff)) {
  :root { --hai-accent: light-dark(#9f7aea, #b07cff); }
}
```

An override that browser can't read would otherwise leave the token with no
colour at all.

`--hai-on-accent` writes on both `--hai-accent` and `--hai-warn`, so an accent
needs ink text, at the default `#0f1115`, to read: the purples above give
5.8:1 and 6.5:1. A white `--hai-on-accent` for a dark accent would put white
text on the amber of a waiting tool row.

### How it looks

Corners are `--hai-radius`. Borders are `--hai-line`, 3px wide, or 2px on
smaller parts: badges, code blocks, the buttons in the header and the message
box, the dots, and the drawer's meter and tool entries. Border widths aren't
tokens. These cast `--hai-shadow`: surfaces, notices, user messages,
suggestions, the new conversation button, and the message box, whose shadow
turns `--hai-accent` while it has focus. A focused button has a 3px
`--hai-fg` outline 2px outside it; a focused tool row has a 2px outline in
its text colour, 3px inside its border.

A tool row's status sets its colours. The status mark is a 12px dot drawn by
`.hai-ticon` itself, with a 2px border in the row's text colour; the glyph
`renderTranscript` puts inside it is hidden.

| Status | Row | Dot | Badge | Shadow |
| --- | --- | --- | --- | --- |
| `running` | `--hai-panel` | `--hai-accent`, blinking | `--hai-panel` | `--hai-shadow` |
| `awaiting` | `--hai-warn`, all its text `--hai-on-accent` | `--hai-accent` | `--hai-panel` | `--hai-shadow` |
| `resolved` | `--hai-panel-2` | `--hai-good` | `--hai-selected` | none |
| `expired` | 10% `--hai-dim` in `--hai-panel-2` | 60% `--hai-dim` in `--hai-bg` | none | none |
| `ok` | `--hai-panel-2` | `--hai-good` | `--hai-panel` | none |
| `error` | `--hai-bad-soft` | `--hai-bad` | `--hai-panel` | `4px 4px 0`, in `--hai-bad` |

A row's name is bold 13px `--hai-mono`. Its arguments are regular 12px
`--hai-mono` in `--hai-dim`, or `--hai-fg` while a failed row is hovered. On
an `awaiting` row they're `--hai-on-accent` in full, like the name, and set
apart from it by weight, so they read as well on `--hai-warn` as
`--hai-on-accent` does: 13.1:1 at the defaults.

A row with a surface under it casts `--hai-shadow` whatever its status, so
the two read as one card, unless the surface is `data-expired`, or docked. An expanded
row's detail is `--hai-panel-2`, under a 3px rule. The progress bar is 7px:
the accent, edged in `--hai-line` along its top and its filled end.

An `error` block and the client's error card are `--hai-bad-soft`, with a
`4px 4px 0` shadow in `--hai-bad`; inside a notice, the error card has
neither border nor shadow. The `expired` block has a dashed border,
no shadow, and no icon. A notice's label is `--hai-user-bg`. While a
surface's props arrive, its skeleton shows hatched bars, the first short and
in `--hai-line`, with the label under them. A `data-expired` surface is at
45% opacity and 70% greyscale, without its shadow.

The status line is bold `--hai-mono`. Thinking shows one blinking
`--hai-accent` dot; waiting shows a pulsing `--hai-warn` one. With
`prefers-reduced-motion: reduce`, nothing blinks, pulses or moves: the
running dot, the pulse, the thinking dot and the skeleton's hatching stand
still, and the drawer, the chevron, the message box and the dock's shelf
don't transition.

**The dock** adds no tokens. A dockable surface's card has the surface's
border and `--hai-shadow`, and its bar is `--hai-panel-2` under a 2px rule,
with the name in bold 11.5px `--hai-mono` and `--hai-dim`. A docked card is a
flat `--hai-panel-2` stub, and a row above a docked card casts no shadow
unless its status does. The bar's buttons, the stub's and the window's are
cells of their bar, 40px wide, behind a 2px rule, holding a 16px icon: Dock
an arrow down onto a line, Put back and Remove from dock an arrow up from
one. They're tinted `--hai-hover` under the pointer.

The shelf is `--hai-panel-2`, joined to the message box as one card: one
3px border, a 3px rule between them, and `--hai-shadow`, which turns
`--hai-accent` while the message box has focus. Its items are 36px tall,
bordered 2px in `--hai-line`, on `--hai-panel` with a `3px 3px 0` shadow:

| Item | Fill | Text | Shadow |
| --- | --- | --- | --- |
| docked | `--hai-panel` | `--hai-fg` | `3px 3px 0` `--hai-line` |
| `awaiting` | `--hai-warn`, with an `--hai-accent` dot | `--hai-on-accent` | `3px 3px 0` `--hai-line` |
| open | `--hai-fg`, pressed 3px down and right; an awaiting one's dot turns `--hai-warn` | `--hai-panel` | none |
| `expired` | none, a dashed `--hai-dim` border | `--hai-dim` | none |

A changed item has a 12px `--hai-accent` square on its top right corner,
bordered in `--hai-line`. The pile is an item with two more edges behind it,
up and to the right, and its list is a `--hai-panel` card with
`--hai-shadow`, under a `--hai-panel-2` heading, 280px wide at most and no
wider than the screen less 32px, its right edge lined up with the shelf's. Remove all, at the shelf's
end, is a 36px button with a 16px icon, an arrow up from two lines, in
`--hai-dim` and no border; under the pointer it takes a 2px `--hai-line`
border on `--hai-hover`, in `--hai-fg`.

The window is `--hai-panel`, 560px wide at most, from the column's left edge,
8px above the status line, raised on an `8px 8px 0` `--hai-line` shadow. In
its title bar a long name is cut short with an ellipsis, after the tool's, so
the badge and buttons stay in reach. The bar is `--hai-fg` with `--hai-panel` text, `--hai-warn` with
`--hai-on-accent` while awaiting, and once out of date the window's border
and the bar's rule turn dashed `--hai-dim` with no shadow, the bar 10%
`--hai-dim` in `--hai-panel-2`. A sheet, on a narrow screen, has no side
borders and no shadow, and the transcript and the status line behind it are
at 40% opacity.

A focused item, or Remove all, has the buttons' 3px `--hai-fg` outline 2px
outside it. A focused button in a bar, or a row of the pile's list, has a 2px
outline in its text colour 6px inside it, so a card can't clip it. Where the
pointer is coarse, items, bars and the stub are at least 44px tall, the bars'
buttons 44px wide, and Remove all 44px square.

## `tailwind.css`

```css
@import "tailwindcss";
@import "@haikit/client/tailwind.css";
```

For an app built with Tailwind CSS v4: an optional peer dependency of
`@haikit/client`, `tailwindcss` `^4.0.0`. It imports [`hai.css`](#haicss), so
an app that imports `tailwind.css` doesn't import `hai.css` as well. And it
gives Tailwind the tokens as theme values, for your surfaces:

```html
<div class="border-3 border-hai-line bg-hai-panel text-hai-dim shadow-hai">
```

| Theme value | Utilities | Is |
| --- | --- | --- |
| `--color-hai-*` | `bg-hai-*`, `text-hai-*`, `border-hai-*` and every other colour utility | One for each colour token above, tints included: `--color-hai-panel` is `var(--hai-panel)`, `--color-hai-line-soft` is `var(--hai-line-soft)` |
| `--font-hai-sans`, `--font-hai-mono` | `font-hai-sans`, `font-hai-mono` | `var(--hai-sans)`, `var(--hai-mono)` |
| `--radius-hai` | `rounded-hai` | `var(--hai-radius)` |
| `--shadow-hai` | `shadow-hai` | `var(--hai-shadow)` |

They're declared `inline`, so a utility uses the token itself and the page
gets no `--color-hai-*` variables. An override of a token on `:root` reaches
your surfaces as it reaches the default UI, and an opacity modifier, as in
`bg-hai-accent/50`, mixes the token. The tokens already follow the scheme, so
these need no `dark:` variant, and `tailwind.css` doesn't define one: your
app's own `dark` variant is left as it is.

Source: `packages/client/src/tailwind.css`.
