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

**3. `loadConversation` acquires a turn lease.**

`Conversation.leaseUntil` existed but was never read, so nothing stopped two
overlapping requests from each loading a copy, mutating it, and having the second
save discard the first turn's messages. One shared object hid this in memory.

`loadConversation` now throws `ConversationBusy` when a live lease is held, and
the route answers **409** instead of letting the throw escape `nodeHandler` and
take down the request. Checked at load rather than at save because a conflict
found after the turn has run has already cost a model call. An expired lease may
be taken, which is what frees a conversation stranded by a crashed process.

`@haikit/client` now checks `res.ok` before parsing a response as SSE — a 409
carries no `data:` frames, so it previously failed silently and the UI just sat
there.

Also new: `npm run storetest`, a conformance suite asserting all of the above
against `memoryStore`, so the reference implementation and a real one cannot
quietly diverge. A Postgres store runs the same file.
