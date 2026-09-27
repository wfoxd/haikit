---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
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
  event reports a refused request.
- **server:** `createHai` rejects a missing, zero, negative, `NaN`, infinite or
  misspelled window with a `RangeError`. A payload whose `createdAt` cannot be
  read counts as expired.
- **client:** `state.expiresAt` and `state.expired` track the deadline, so a tab
  left open closes on time. `send` and `interact` stop sending, and surfaces
  become `inert`. The new `chat.reset()` starts a new conversation, and requests
  still open or queued for the old one are dropped. The default transcript shows
  the notice with a *Start a new conversation* button.

To upgrade, add `staleAfterMs` to each `.implement({...})`. `"never"` keeps
today's behaviour.
