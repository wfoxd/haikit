---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/postgres": minor
---

**Breaking:** every surface implementation must now declare `staleAfterMs`, the
time in milliseconds for which its data may be acted on, or `"never"`.

```ts
flightTable.implement({ digest, actions, queries, staleAfterMs: 15 * 60_000 });
greetingPicker.implement({ digest, actions, queries, staleAfterMs: "never" });
```

Once any surface in a conversation is past its window, the conversation is
closed. Every further request, whether a click or a typed message, is refused
before the model runs, and nothing is recorded. Answered surfaces count too,
because what the user picked from one is still in the model's context at the
price it was shown at. Before this, a picker left open over a weekend resolved
against last week's data without saying so, and now that conversations survive
restarts in `@haikit/postgres`, that had become easy to hit.

- **core:** `staleAfterMs` is required on `SurfaceImplDef`, the fifth guarantee
  enforced by the types. `ui_open` carries the window, and a new `expired` wire
  event reports a refused request. `PayloadRecord` gains `staleAfterMs`, the
  window the payload rendered under, and stores must return it exactly as
  given, including `"never"`.
- **the window is recorded, not looked up later:** a request is held to the
  stricter of a payload's recorded window and the one the code declares now.
  Tightening a window in a later deploy applies to data already shown.
  Renaming a surface, removing it or relaxing its window never lets that data
  last longer. A payload whose window is known nowhere counts as expired.
- **server:** `createHai` rejects a missing, zero, negative, `NaN`, infinite or
  misspelled window with a `RangeError`. A payload whose `createdAt` cannot be
  read counts as expired.
- **postgres:** `haikit_payloads` gains a nullable `stale_after_ms` column.
  **Run `migrate()` after upgrading**: it adds the column to an existing table.
  Rows written before the column existed read as unknown and are held to the
  window the code declares now. With your own migration tool, apply the new
  `ALTER TABLE` statement from `schema`.
- **client:** `state.expiresAt` and `state.expired` track the deadline, so a tab
  left open closes on time. `send` and `interact` stop sending, and surfaces
  become `inert`. The new `chat.reset()` starts a new conversation, and requests
  still open or queued for the old one are dropped. The default transcript shows
  the notice with a *Start a new conversation* button.

To upgrade, add `staleAfterMs` to each `.implement({...})`. `"never"` keeps
today's behaviour. With `@haikit/postgres`, also run `migrate()` once.
