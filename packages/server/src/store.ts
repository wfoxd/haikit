import {
  ConversationBusy,
  StaleLease,
  type Conversation,
  type PayloadRecord,
  type StoreAdapter,
} from "@haikit/core";

const LEASE_MS = 120_000;

export interface MemoryStoreOptions {
  /**
   * Turn lease TTL. A process that dies mid-turn strands the conversation for
   * this long; too short and a slow turn is overtaken while still running.
   *
   * This is the single authority on lease duration — the runtime does not renew
   * or override it. Being overtaken is safe rather than merely unlikely: the
   * superseded turn's save is rejected by its fencing token.
   */
  leaseMs?: number;
}

/**
 * In-memory store. Implements the same interface a Postgres store would, and
 * enforces the same rules — scoping, leasing and fencing are all checked here
 * even though this store could get away without them. A reference
 * implementation that only enforces what it happens to need is what let three
 * of these bugs exist in the first place.
 *
 * Conversations are copied in and out rather than shared by reference. That is
 * not an optimisation detail: a store that hands back a live object cannot
 * detect a stale writer at all, because the caller's copy *is* the stored one.
 * The copy is a JSON round trip specifically because that is what a `jsonb`
 * column does — anything a real store would silently drop (undefined, a Date's
 * type, a class instance) gets dropped here too, in development.
 *
 * Swapping this for a durable store is the single highest-value change for
 * production: a parked `elicit` turn is durable state, and losing `pending`
 * makes a conversation permanently unsendable.
 */
export function memoryStore(options: MemoryStoreOptions = {}): StoreAdapter {
  const leaseMs = options.leaseMs ?? LEASE_MS;
  const conversations = new Map<string, Conversation>();
  const payloads = new Map<string, PayloadRecord>();
  let convSeq = 0;
  let handleSeq = 0;

  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const newToken = () => globalThis.crypto.randomUUID();

  /** Every durable mutation presents the token it was issued. A holder that has
   *  been superseded must stop writing rather than run to completion and be
   *  discarded at the end.
   *
   *  Atomic here only because nothing awaits between this check and the write
   *  that follows it: JavaScript cannot interleave another request into a
   *  synchronous run. Put an `await` between them and the compare-and-set the
   *  contract requires is silently gone. */
  const fence = (conversationId: string, leaseToken: string | null) => {
    const stored = conversations.get(conversationId);
    // Mirrors the SQL shape in the contract: no matching row fails the
    // compare-and-set exactly like a superseded token does. A null token needs
    // no case of its own — a stored lease is never null, so it cannot match,
    // just as `NULL = x` is never true. What must not happen is treating a
    // missing token as "unfenced" and skipping this comparison.
    if (!stored) throw new StaleLease(conversationId, "does not exist — no lease was ever issued for it");
    if (stored.leaseToken !== leaseToken) throw new StaleLease(conversationId);
  };

  return {
    async loadConversation(id) {
      if (id && conversations.has(id)) {
        const stored = conversations.get(id)!;
        if (stored.leaseUntil !== null && stored.leaseUntil > Date.now()) {
          throw new ConversationBusy(stored.id);
        }
        // Reissuing the token is what fences out whoever held it before.
        stored.leaseUntil = Date.now() + leaseMs;
        stored.leaseToken = newToken();
        return copy(stored);
      }
      const conversation: Conversation = {
        id: `conv_${++convSeq}`,
        status: "idle",
        messages: [],
        handles: [],
        frozen: [],
        pending: null,
        leaseUntil: Date.now() + leaseMs,
        leaseToken: newToken(),
      };
      conversations.set(conversation.id, conversation);
      return copy(conversation);
    },

    async saveConversation(conversation) {
      // Same rule as every other fenced write. Not an upsert: a conversation
      // this store never issued a lease for cannot be created by saving it.
      fence(conversation.id, conversation.leaseToken);
      conversations.set(conversation.id, copy(conversation));
    },

    async putPayload(record, leaseToken) {
      fence(record.conversationId, leaseToken);
      const handle = `ui_${String(++handleSeq).padStart(2, "0")}`;
      payloads.set(handle, copy({ ...record, handle, createdAt: Date.now() }));
      return handle;
    },

    /** Scoped: a handle from another conversation must not resolve. */
    async getPayload(handle, conversationId) {
      const record = payloads.get(handle);
      if (!record || record.conversationId !== conversationId) return null;
      return copy(record);
    },

    async getPayloads(handles, conversationId) {
      const out: PayloadRecord[] = [];
      for (const handle of handles) {
        const record = payloads.get(handle);
        if (record && record.conversationId === conversationId) out.push(copy(record));
      }
      return out;
    },
  };
}
