---
"@haikit/server": minor
"@haikit/client": minor
---

The events stream falls back to polling for browsers behind a proxy that holds streams back until they end, as HTTPS-inspecting corporate tools such as Netskope and Zscaler do. A browser behind one heard no notices, signals or wake turns.

The server now greets every events stream with a comment (`: open`). A client that hears nothing at all within `eventsFallbackMs` (default 8 s, a new `createChat` option) switches to polling `GET /events?poll=1`, and remembers that for a day in `localStorage`. `pollHoldMs` (default 15 s) sets how long each poll asks the server to hold.

A poll sends what's waiting and ends, and responses that end get through any proxy:
- It sends notices after `Last-Event-ID`, each signal's latest value, and a wake turn's frames, as the stream does.
- It ends about 250 ms after something new goes out, or after 15 s with nothing new; `?poll=now` answers at once.
- A signal's latest value counts as new only when the client lacks it, judged by a fingerprint the client sends.
- A wake turn that ends between two polls is kept for a minute, the last five at most. The next poll whose `turn` parameter shows it hasn't seen those turns end gets all of each, oldest first.
- A poll that finds no wake turn running says so with `released`.
- A server keeps hearing a conversation for a minute after its last stream or poll closes, so polls that move between servers still get a turn that ended on another.
- Back-to-back polls keep a tab counted in presence.
