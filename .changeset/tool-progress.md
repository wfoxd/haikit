---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
---

Tools can report progress. `ctx.progress({ message, done, total })` sends a `progress` frame to the browser for the tool's row, throttled to one every 100 ms with the last always sent. It is UI channel only: nothing is stored, and the model never sees it. The default UI shows the message and count in the row's status, with a bar once the tool gives a `total`.
