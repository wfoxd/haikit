---
"@haikit/client": minor
---

The default UI is styled with Tailwind. Each element it builds carries its `hai-*` hook, as before, followed by `hai:` utilities, prefixed and sized in pixels, that `hai.css` now holds: the tokens and their theme pins don't change, and neither does how the UI looks, with three exceptions where it now matches what the reference always said. The model context debug drawer is `--hai-inspector-width` wide with its border, 400px by default, not 3px more; the dock's pile list is 280px wide with its border, not 286px; and a tool row's input and result are 200px tall at most with their border and padding, not 222px.

The hooks carry no styles of their own now, and a page's CSS reset, Tailwind's preflight among them, no longer changes the default UI: every element sets its own `box-sizing`, and the header, the surface bars, the status line and the drawer's meter keep their sizes under one. The utilities aren't API. Select by the hooks, never by the utilities, and restyle by the tokens, or by a rule on a hook at least as specific as the default UI's own for that state. Anything that compared an element's `class` to a single hook, such as `className === "hai-notice"`, should check for the hook among its classes instead.
