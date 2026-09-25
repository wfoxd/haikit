import { ConversationBusy, type Conversation, type PayloadRecord, type StoreAdapter } from "@haikit/core";

/** Matches the runtime's own default, so a lease taken here and refreshed
 *  mid-turn expires on the same clock. */
const LEASE_MS = 120_000;

export interface MemoryStoreOptions {
  /** Turn lease TTL. A process that dies mid-turn strands the conversation for
   *  this long; too short and a slow turn can be stolen from under itself. */
  leaseMs?: number;
}

/**
 * In-memory store. Implements the same interface a Postgres store would, and
 * enforces the same rules — scoping and leasing are checked here even though
 * this store could get away without them, because a store that only enforces
 * what it happens to need is not a reference implementation.
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

  return {
    async loadConversation(id) {
      if (id && conversations.has(id)) {
        const existing = conversations.get(id)!;
        if (existing.leaseUntil !== null && existing.leaseUntil > Date.now()) {
          throw new ConversationBusy(existing.id);
        }
        existing.leaseUntil = Date.now() + leaseMs;
        return existing;
      }
      const conversation: Conversation = {
        id: `conv_${++convSeq}`,
        status: "idle",
        messages: [],
        handles: [],
        pending: null,
        leaseUntil: Date.now() + leaseMs,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },

    async saveConversation(conversation) {
      conversations.set(conversation.id, conversation);
    },

    async putPayload(record) {
      const handle = `ui_${String(++handleSeq).padStart(2, "0")}`;
      payloads.set(handle, { ...record, handle, createdAt: Date.now() });
      return handle;
    },

    /** Scoped: a handle from another conversation must not resolve. */
    async getPayload(handle, conversationId) {
      const record = payloads.get(handle);
      if (!record || record.conversationId !== conversationId) return null;
      return record;
    },

    async getPayloads(handles, conversationId) {
      const out: PayloadRecord[] = [];
      for (const handle of handles) {
        const record = payloads.get(handle);
        if (record && record.conversationId === conversationId) out.push(record);
      }
      return out;
    },

    /** Scoped for the same reason as getPayload, and enforced the same way —
     *  handles happen to be globally unique here, but a store that numbers them
     *  per conversation must behave identically. */
    async freezePayload(handle, conversationId) {
      const record = payloads.get(handle);
      if (record && record.conversationId === conversationId) record.state = "frozen";
    },
  };
}
