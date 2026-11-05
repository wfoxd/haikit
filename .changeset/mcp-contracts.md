---
"@haikit/mcp": minor
---

The connect card's and the notice's contracts, for asking a user to connect an `oauth()` server's account and for telling the conversation they have. `connectCard` is a surface named `connect_card`, version 1, with no actions, whose props are `ConnectCardProps`, `{ server, label, need, href }`: `href` must be a path on the app, so `//evil.example` and `/\evil.example` are refused. `connectCardFor(err, label?)` makes those props from an `auth` error with `err.auth.connect`, or gives `null` for any other error. `accountConnected` is a wake notice named `account_connected`, version 1, with `{ server }`, for `onConnected` to send with `hai.notify`. The app implements each with its own words for the model, and the browser imports them as types only, since the package's entry loads Node's modules.
