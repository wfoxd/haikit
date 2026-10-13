---
"@haikit/client": patch
---

`mountChat` now takes `eventsFallbackMs` and `pollHoldMs` and passes them to `createChat`, so a page using the default UI can tune polling too. And a message whose request fails, such as on a network error, now comes back to the message box and is logged, rather than being lost with an unhandled rejection; a `start()` that fails is logged the same way.
