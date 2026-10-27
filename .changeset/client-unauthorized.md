---
"@haikit/client": minor
---

`createChat` and `mountChat` take `fetch`, which every request goes through, the events stream's included: pass one to add an `authorization` header, or `credentials: "include"`. A 401 or 403 now sets `state.unauthorized` to `{ status, message }`, stops the events stream instead of retrying it for ever, and tells subscribers `{ type: "unauthorized", status, message }`. `chat.resume()` clears it and reopens the events stream, as a request answered 200 does by itself, and subscribers hear `{ type: "resumed" }`. A message turned away with 401, 403 or 404 now counts as not sent, as a 409 does, so `send` resolves `false` and the default UI gives the text back. `mountChat` takes `signIn: { href, label? }`: while the chat is turned away, the status line (`data-status="unauthorized"`) says why, followed by a link, `a.hai-signin`.
