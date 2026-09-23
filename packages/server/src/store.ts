import type { Conversation, PayloadRecord, StoreAdapter } from "@haikit/core";

/**
 * In-memory store. Implements the same interface a Postgres store would.
 *
 * Swapping this for a durable store is the single highest-value change for
 * production: a parked `elicit` turn is durable state, and losing `pending`
 * makes a conversation permanently unsendable.
 */
export function memoryStore(): StoreAdapter {
  const conversations = new Map<string, Conversation>();
  const payloads = new Map<string, PayloadRecord>();
  let convSeq = 0;
  let handleSeq = 0;

  return {
    async loadConversation(id) {
      if (id && conversations.has(id)) return conversations.get(id)!;
      const conversation: Conversation = {
        id: `conv_${++convSeq}`,
        status: "idle",
        messages: [],
        handles: [],
        pending: null,
        leaseUntil: null,
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

    async freezePayload(handle) {
      const record = payloads.get(handle);
      if (record) record.state = "frozen";
    },
  };
}
