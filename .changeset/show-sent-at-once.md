---
"@haikit/client": minor
---

A message and a click show that they have gone as soon as their request goes out, not when the server's first frame arrives. A proxy that inspects traffic, such as Netskope, can hold a whole response back until the turn ends, and the page looked as if nothing had happened until then. `status` becomes `streaming` at once, so the default UI says Thinking, and a sent message is in `blocks` as a `user` block with `pending: true` (id `s<n>`; `data-pending` in the default transcript) until the server's own copy takes its place. If none arrives, because the message was turned away, the stream said `error` or `expired`, the request failed, or `close()` was called, the pending block is taken out again, and a `status` the server never set goes back to what it was. Subscribers hear `{ type: "sending" }` as the request goes out and `{ type: "settled" }` once its response has ended. `start()` is unchanged.
