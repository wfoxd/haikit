---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
---

A surface replayed to a stream that joins a wake turn part way now carries `ageMs` on its `ui_open`: how long ago the server stored it. The browser counts its freshness window from then, not from when the frame arrived, so a tab that connects or reconnects mid-turn no longer gives an out-of-date surface extra time. It's a duration, not a time, so browser and server clocks are never compared. Surfaces streamed as they're shown carry no age and are counted as before.

Every SSE response now sends `cache-control: no-cache, no-transform` and `x-accel-buffering: no`, asking proxies not to buffer or transform the stream, since frames held back make the browser's deadlines late.
