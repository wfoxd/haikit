import type { AuthStore } from "./index.js";

/**
 * Ownership and revocations in this process's memory. Gone on a restart, and
 * not shared: with several servers, use `pgAuthStore`.
 */
export function memoryAuthStore(): AuthStore {
  const owners = new Map<string, string>();
  const notBefore = new Map<string, number>();
  return {
    async getOwner(conversationId) {
      return owners.get(conversationId) ?? null;
    },
    async setOwner(conversationId, userId) {
      const had = owners.get(conversationId);
      if (had !== undefined && had !== userId) throw new Error(`conversation ${conversationId} already belongs to someone else`);
      owners.set(conversationId, userId);
    },
    async getNotBefore(userId) {
      return notBefore.get(userId) ?? null;
    },
    async setNotBefore(userId, at) {
      notBefore.set(userId, Math.max(at, notBefore.get(userId) ?? at));
    },
  };
}
