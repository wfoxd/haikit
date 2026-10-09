---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
---

Every `ui_open` now carries `ageMs`: how long ago the server stored the surface. That's measured from just before the payload is written, so a slow digest counts, and for a surface replayed to a stream that joins a wake turn part way, its wait counts too. The browser counts the freshness window from the earlier of its own request and that age, so a tab that connects or reconnects mid-turn no longer gives an out-of-date surface extra time. It's a duration, not a time, so browser and server clocks are never compared.

Every SSE response now sends `cache-control: no-cache, no-transform` and `x-accel-buffering: no`, asking proxies not to buffer or transform the stream, since frames held back make the browser's deadlines late.
