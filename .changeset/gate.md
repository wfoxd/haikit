---
"@haikit/core": minor
"@haikit/server": minor
---

A gate decides who may use the routes, and which conversations each may use. `@haikit/core` exports `Gate`, `GateRequest`, `GateRoute` and `Admission`, and `nodeHandler(hai, basePath, { gate })` asks it before anything else happens. `admit` runs before a POST body is read, and before `/start`'s empty answer, and its refusal is answered with its own status (401, 403 or 415) and `{ "error" }`. `allows` runs for the conversation a request names before it is loaded: `false` is a 404 `unknown conversation`, the same as an id that doesn't exist, so a stranger never takes the owner's lease. A conversation a request creates is passed to `created` before `hello` names it; if that rejects, the stream says why and the browser never learns the id. The events stream is admitted the same way, ends when its admission's `until` passes, and asks the gate again every 60 s. Behind a gate, a `conversationId` that isn't a non-empty string counts as none. Without a gate nothing changes.
