---
"@haikit/client": patch
---

The chat no longer slides sideways when something on the page is brought into view centred, as find in page and many testing tools do. The area holding the chat and the closed model context drawer clipped the drawer with `overflow: hidden`, which can still be scrolled, so the whole conversation could shift off the left edge and stay there. It now uses `overflow: clip`, falling back to `hidden` in browsers without it.
