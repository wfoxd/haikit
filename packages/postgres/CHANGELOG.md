# @haikit/postgres

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
