# @haikit/server

## 0.3.1

### Patch Changes

- 7a41949: `memoryStore({ leaseMs })` now rejects a zero, negative, `NaN` or infinite TTL
  with a `RangeError` instead of accepting it.

  A TTL of zero or less made every lease expire the moment it was taken, so every
  `loadConversation` succeeded and two requests could hold one conversation at
  once — the one-turn-in-flight guarantee was silently off. An infinite TTL would
  have stranded a crashed turn's conversation forever. Omitting `leaseMs` keeps the
  default of two minutes.

  - @haikit/core@0.3.1

## 0.3.0

### Minor Changes

- 207786d: Make `StoreAdapter` safe for a store that is not in this process.

  Three rules the in-memory store could get away with ignoring, and a networked
  one cannot. Groundwork for a Postgres adapter, but each is a real fix on its own.

  **Breaking, for `StoreAdapter` implementers only.** Applications calling
  `createHai({ store: memoryStore() })` need no change.

  **1. Payloads are immutable; frozen state moves onto the conversation.**

  ```diff
  - freezePayload(handle: string): Promise<void>        // removed
    interface PayloadRecord {
  -   state: "live" | "frozen";                         // removed
    }
    interface Conversation {
  +   frozen: string[];
    }
  ```

  Answering an elicit surface is one transition with two halves: the surface stops
  accepting clicks, and the history records what the user chose. The first half
  lived on the payload row and the second on the conversation row, so no amount of
  fencing could keep them together — a turn could legitimately freeze the payload,
  lose its lease during the model call, and have its save rejected, leaving the
  surviving history awaiting a surface that could never be clicked again.

  Both halves now live on the conversation row and commit in the same fenced save.
  Payloads are write-once, so a durable store needs no transaction spanning two
  tables. This also removes the scoping gap `freezePayload` had (it took no
  conversation id), rather than patching it.

  **2. `getPayloads` batches the context read.**

  ```diff
  + getPayloads(handles: string[], conversationId: string): Promise<PayloadRecord[]>
  ```

  The context inspector read every live payload one at a time, on every turn — a
  map lookup in memory, a round trip each against a real store, growing for as
  long as a conversation lives.

  **3. `loadConversation` acquires a fenced turn lease.**

  `Conversation.leaseUntil` existed but was never read, so nothing stopped two
  overlapping requests from each loading a copy, mutating it, and having the second
  save discard the first turn's messages. One shared object hid this in memory.

  `loadConversation` now throws `ConversationBusy` when a live lease is held, and
  the route answers **409** instead of letting the throw escape `nodeHandler` and
  take down the request. Checked at load rather than at save because a conflict
  found after the turn has run has already cost a model call.

  Expiry alone is not mutual exclusion, so `Conversation` also carries a
  `leaseToken`, reissued on every acquisition. A request slower than the TTL loses
  the lease while still running; another process takes it and saves a newer turn;
  the first then finishes and would write its stale copy over the top.
  `saveConversation` now throws `StaleLease` when the token no longer matches, and
  the route reports it rather than silently discarding a turn.

  For any of that to be detectable, a store must return conversations
  **independent of stored state** — a live reference makes the caller's copy and
  the stored row the same object, with nothing to compare. `memoryStore` now
  copies in and out via a JSON round trip, chosen because that is exactly what a
  `jsonb` column does: anything a real store would quietly drop gets dropped in
  development instead.

  The lease is released only at the request boundary. Releasing it when a turn
  parks let the client's next interaction arrive before the request had finished
  writing, and the two turns interleave.

  `HaiConfig.leaseMs` is **removed**. The TTL now has one owner — the store — where
  previously the runtime overwrote `leaseUntil` with its own value, so a store
  configured for 40ms silently became 120s under the default config.

  Acquisition is documented as needing to be **atomic**: one conditional update,
  not a read followed by a write. Two instances can both observe an expired lease
  before either writes, and both acquire. No conformance test can hold an adapter
  to this — a single process cannot interleave two acquisitions — so it is called
  out as a review item rather than left implied.

  **4. `putPayload` is fenced.**

  ```diff
  - putPayload(record): Promise<string>
  + putPayload(record, leaseToken: string | null): Promise<string>
  ```

  A superseded turn should stop working rather than run to completion and be
  discarded. For that to actually happen, `StaleLease` escapes the tool boundary
  instead of being converted into an ordinary "tool failed" result, which would
  have handed the lost lease back to the model and kept paying for hops whose
  output the fenced save discards.

  Both fenced writes — `saveConversation` and `putPayload` — are documented as
  needing the token check and the write to be one statement, for the same reason
  as lease acquisition. Neither accepts a conversation the store never issued a
  lease for: saving is not an upsert, and a payload cannot be written against an
  unknown conversation or with a null token — both of which the documented
  compare-and-set rejects for free.

  **5. An interaction is refused unless the conversation records its handle.**

  `putPayload` commits during a turn; the conversation save at the end may be
  rejected. A turn that rendered a surface and was then overtaken therefore leaves
  a live payload row that the winning history never references — and the browser
  that mounted it is still open and can still click. Scoping by conversation id
  does not catch this, because the row genuinely belongs to that conversation.

  `Conversation.handles` is now load-bearing rather than bookkeeping: membership is
  checked before any interaction, which makes orphaned surfaces inert. The rows
  themselves still need sweeping, which is what `createdAt` is for.

  `@haikit/client` now checks `res.ok` before parsing a response as SSE — a 409
  carries no `data:` frames, so it previously failed silently and the UI just sat
  there. It also gates requests on whether one is actually in flight rather than on
  `state.status`: the server emits `awaiting` from inside the turn and releases its
  lease afterwards, and the composer is deliberately live in that state ("pick an
  option above — or type to override"), so an override landing in that window is
  normal rather than misuse. Sends are **queued** rather than refused —
  `mountChat` clears the textarea before calling `send`, so a refused send deletes
  what the user typed — and go out strictly one at a time. A click while a request
  is open is still dropped, since stacking it would turn a double-click into
  "component is frozen". A 409 is retried once before being surfaced, which covers
  a second tab that no client-side gate can prevent.

  Also new: `npm run storetest`, a conformance suite asserting all of the above
  against `memoryStore`, so the reference implementation and a real one cannot
  quietly diverge. A Postgres store runs the same file.

### Patch Changes

- Updated dependencies [207786d]
  - @haikit/core@0.3.0

## 0.2.0

### Minor Changes

- 2eeff96: Expose each query's argument schema to the model in `query_ui`.

  `query_ui` advertised `args: { type: "object" }` with no properties, and its
  catalogue listed only query names — so a model could see that `filter` existed
  but not that it took `rtl` or `script`. It called the query with no arguments,
  every filter became a no-op, and it got the whole collection back and answered
  from it. `QuerySpec.description` was never read at all.

  `query()` now takes an optional third argument, a JSON Schema for its args,
  mirroring `defineTool`'s existing `inputJsonSchema`. The derived `query_ui` tool
  lists each query with its description and that schema. A query missing it logs a
  warning at construction, because the failure mode is a wrong answer rather than
  an error.

  ```ts
  filter: query(
    z.object({ rtl: z.boolean().optional() }),
    "Greetings in a given writing direction",
    { type: "object", properties: { rtl: { type: "boolean" } } }
  );
  ```

  Additive and backwards compatible: existing two-argument calls still compile and
  behave as before, minus the silence.

### Patch Changes

- Updated dependencies [2eeff96]
  - @haikit/core@0.2.0
