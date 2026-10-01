---
"@haikit/client": minor
---

Surfaces now mount once and can clean up when they go away.

- **Mounted once.** The default transcript keeps each block's element while what it shows is unchanged. A surface mounts once instead of on every streamed event, and keeps its own state while the conversation goes on, such as a filter, an expanded row or a React tree. Unchanged elements are never taken out and put back, and an expanded tool row stays expanded when its status changes.
- **`unmount()`.** A component's `mount` may return `unmount()`. It is called when the surface goes away: on `chat.reset()`, on `chat.close()`, or when the surface is mounted again.
- **`chat.close()`.** It ends a chat for good: open requests are aborted, every surface is unmounted, and subscribers hear `{ type: "closed" }`. After that, `send` and `start` resolve `false` and nothing else is sent. `mountChat` removes its shell when its chat closes, and `closeTranscript(root)` releases a transcript rendered directly.
