---
"@haikit/server": minor
---

`nodeHandler` takes a third argument, `options`, with `maxBodyBytes` (default 1 MiB). A POST body longer than that is answered 413 `{ "error": "the request body is too large" }` with `connection: close`, as soon as its `content-length` or what has arrived says so, and the rest of it is drained rather than kept: before, one request could make the server hold a body of any size. `/interact` naming no conversation that exists (missing, not a string, or unknown to the store) is now answered 404 `{ "error": "unknown conversation" }`, as the events route is, instead of creating an empty conversation whose id nobody was told and refusing the click with `unknown handle`.
