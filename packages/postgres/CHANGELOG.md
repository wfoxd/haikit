# @haikit/postgres

## 0.13.0

### Minor Changes

- aeede82: The server can now tell a conversation something outside of any request, with a notice. Declare one with `defineNotice` (core) beside your surfaces, implement it with a required `model` function (what the model hears, or `null`), list it in `createHai({ notices })`, and send it with `hai.notify(conversationId, notice, payload, { handle })` from anywhere: a webhook, a job queue, an action handler's follow-up.

  The payload is typed from the contract and checked against its schema before it is stored. It goes to the browser over a new route, `GET /hai/events`, which `hello` tells the client to open; the client resumes with `Last-Event-ID` after a dropped connection. The `model` text goes to the model in the next user message the conversation records, after any tool results, and is taken in on the fenced conversation row, so a turn whose save is lost leaves it unread. `notify` takes no lease, and a notice never starts a turn.

  The client renders notices from a `notices` registry, passed to `createChat` or `mountChat`, with no `send`. `@haikit/react` adds `reactNotice`.

  **Breaking for custom stores:** `StoreAdapter` gains `putNotice` and `getNotices`, and an optional `watch`. `memoryStore()` and `pgStore()` implement them. `@haikit/postgres`'s `migrate()` adds the `haikit_notices` table and two columns on `haikit_conversations`; pass `listen` to `pgStore` so the events route hears of notices at once rather than at its next two-second read.

### Patch Changes

- Updated dependencies [aeede82]
  - @haikit/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [e6c1f1c]
  - @haikit/core@0.12.0

## 0.11.0

### Patch Changes

- @haikit/core@0.11.0

## 0.10.0

### Patch Changes

- @haikit/core@0.10.0

## 0.9.2

### Patch Changes

- @haikit/core@0.9.2

## 0.9.1

### Patch Changes

- @haikit/core@0.9.1

## 0.9.0

### Patch Changes

- @haikit/core@0.9.0

## 0.8.0

### Patch Changes

- @haikit/core@0.8.0

## 0.7.0

### Patch Changes

- @haikit/core@0.7.0

## 0.6.2

### Patch Changes

- @haikit/core@0.6.2

## 0.6.1

### Patch Changes

- @haikit/core@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [801813d]
  - @haikit/core@0.6.0

## 0.5.0

### Patch Changes

- @haikit/core@0.5.0

## 0.4.0

### Minor Changes

- 5bacab1: Surfaces can declare `staleAfterMs`: the time in milliseconds for which their
  data may be acted on, or `"never"`, which is the default. Existing code keeps
  working unchanged, because a surface that declares no window never expires.

  ```ts
  flightTable.implement({
    digest,
    actions,
    queries,
    staleAfterMs: 15 * 60_000,
  });
  greetingPicker.implement({ digest, actions, queries }); // "never"
  ```

  Once any surface in a conversation is past its window, the conversation is
  closed. Every further request, whether a click or a typed message, is refused
  before the model runs, and nothing is recorded. Answered surfaces count too,
  because what the user picked from one is still in the model's context at the
  price it was shown at. Without a window, a picker left open over a weekend
  would resolve against last week's data without saying so, and now that
  conversations survive restarts in `@haikit/postgres`, that had become easy to
  hit.

  - **The window is recorded, not looked up later.** A request is held to the
    stricter of a payload's recorded window and the one the code declares now.
    Tightening a window in a later deploy applies to data already shown.
    Renaming a surface, removing it or relaxing its window never lets that data
    last longer. A payload whose window is known nowhere, or whose row is
    missing, counts as expired.
  - **core:** adds the optional `staleAfterMs` on `SurfaceImplDef`. `ui_open`
    carries the window, and a new `expired` wire event reports a refused
    request. `PayloadRecord` gains the optional `staleAfterMs`, which stores
    should return exactly as given, including `"never"`.
  - **server:** `createHai` rejects a zero, negative, `NaN`, infinite or
    misspelled window with a `RangeError`, `null` included. A payload held to a
    window whose `createdAt` cannot be read counts as expired.
  - **client:** `state.expiresAt` and `state.expired` track the deadline,
    counted from when the request was sent, so a tab left open closes on time.
    `send` and `interact` stop sending, and surfaces become `inert`. The new
    `chat.reset()` starts a new conversation and aborts anything still open for
    the old one. `send()` now resolves to whether the server took the message,
    so a UI that cleared its input can give the text back when a queued message
    is turned away. The default composer does this. The default transcript shows
    the notice with a _Start a new conversation_ button.
  - **postgres:** `haikit_payloads` gains a nullable `stale_after_ms` column,
    which `migrate()` adds to an existing table. Calling `migrate()` at startup,
    as the README shows, handles this. With your own migration tool, apply the
    new `ALTER TABLE` statement from `schema` before deploying. Rows written
    before the column existed are held to the window the code declares now.

### Patch Changes

- Updated dependencies [5bacab1]
  - @haikit/core@0.4.0

## 0.3.1

### Patch Changes

- @haikit/core@0.3.1
