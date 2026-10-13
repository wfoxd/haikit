---
"@haikit/client": patch
---

A surface's `freeze` or `expire` hook that throws no longer breaks the chat: like `update` and `unmount`, they're isolated and their errors reported afterwards, so a throwing `expire` can't leave the surfaces after it clickable on an expired conversation. A component whose `mount` returns nothing now shows a revision, by being mounted again. While polling, a 404 during a wake turn no longer leaves every later request waiting, and a poll that ends normally resets the reconnect backoff.
