---
"@haikit/client": minor
---

A redesigned default UI. `mountChat` and `hai.css` now give you:

- **Light and dark.** The UI follows the system's colour scheme. `<html data-hai-theme="dark">` or `mountChat({ theme: "dark" })` pins it. Before, it was dark only. Every token is set at zero specificity, so a plain `:root` override in your sheet still wins. Use `light-dark()` to give a token one value per scheme. Browsers without `light-dark()` get the dark scheme.
- **New tokens for your surfaces**, so they follow the scheme too. `--hai-hover` and `--hai-selected` are for rows and pickers, `--hai-line-soft` is for dividers, and `--hai-on-accent` is for text on the accent. `--hai-accent`, `--hai-good`, `--hai-warn` and `--hai-bad` each get a `-soft` tint.
- **A header with New chat and Context.** New chat calls `chat.reset()`. Context opens the model context debug drawer, and shows how many tokens the model holds even while the drawer is closed.
- **The inspector is now the model context debug drawer.** It starts closed and slides in from the right. On a wide screen the chat makes room for it, and on a narrow one it opens over the chat. Before, it was a fixed column that was hidden entirely on narrow screens. Escape or its close button shuts it, and it opens again after a reload if it was open before. `inspector: false` still leaves it out.
- **Tool rows that say where the call stands.** A row shows `awaiting you` while the turn is parked on its surface and `resolved` once the surface has been answered or typed over. It used to keep saying "awaiting user" after the user had answered. Expanded, a row shows the call's input as well as its `tool_result`.
- **A centred conversation.** User messages are right-aligned bubbles. Each paragraph takes its own text direction. The composer grows as you type. The status line is announced to screen readers once per change, not once per streamed word.
- **A drawer led by its numbers.** The share of the payload kept out of context stays at the top as the context scrolls beneath it.

Class names that apps may target are kept, including `.hai-surface`, `.hai-tool`, `.hai-status-*`, `.hai-input` and `.hai-send`. The send button is now an icon, with the accessible name "Send".
