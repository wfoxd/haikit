---
"@haikit/core": minor
"@haikit/server": minor
"@haikit/client": minor
"@haikit/anthropic": minor
---

Make `StoreAdapter` safe for a store that is not in this process.

Three rules the in-memory store could get away with ignoring, and a networked
one cannot. Groundwork for a Postgres adapter, but each is a real fix on its own.

**Breaking, for `StoreAdapter` implementers only.** Applications calling
`createHai({ store: memoryStore() })` need no change.

**1. `freezePayload` is scoped.**

```diff
- freezePayload(handle: string): Promise<void>
+ freezePayload(handle: string, conversationId: string): Promise<void>
```

`getPayload` was already scoped — a handle from another conversation must not
resolve — but `freezePayload` was not. Not exploitable, since every call site
freezes a handle a scoped `getPayload` just returned, but it forced handles to be
globally unique: without the conversation, `handle` alone does not identify a
row. A store numbering handles per conversation could not implement it.

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

**4. An interaction is refused unless the conversation records its handle.**

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
there.

Also new: `npm run storetest`, a conformance suite asserting all of the above
against `memoryStore`, so the reference implementation and a real one cannot
quietly diverge. A Postgres store runs the same file.
