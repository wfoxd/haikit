/**
 * Where each user's credentials are kept, with the OAuth clients registered
 * for them and the connect flows on their way. `memoryCredentialStore` for
 * one process; `pgCredentialStore` from `@haikit/mcp/postgres` for several.
 *
 * Every value is an opaque string, sealed before the store sees it: a leaked
 * table or backup holds no usable token. Two sealings of the same thing never
 * give the same string, so a value tells one write from another.
 */
export interface CredentialStore {
  /** A user's sealed credential for a server, or null. */
  get(userId: string, server: string): Promise<string | null>;
  /**
   * Writes a user's credential for a server if the row still holds
   * `previous` (null: no row yet), and resolves true. False if another write
   * came first: the check and the write must be one atomic step.
   */
  put(userId: string, server: string, value: string, previous: string | null): Promise<boolean>;
  /**
   * Deletes one server's credential, or with no `server`, all of the user's.
   * With `previous`, only if the row still holds it.
   */
  delete(userId: string, server?: string, previous?: string): Promise<void>;
  /** The servers a user has a credential for. */
  list(userId: string): Promise<string[]>;
  /**
   * The refresh lease of a user's credential for a server, so one process at
   * a time spends its refresh token. Taken for `ms`, by the store's clock, if
   * the row still holds `previous` and no lease but `holder`'s is held: true.
   * Else false, changing nothing. `ms` 0 gives `holder`'s back. A write or a
   * delete of the row ends its lease; a lease is no write.
   */
  lease(userId: string, server: string, previous: string, holder: string, ms: number): Promise<boolean>;
  /** A registered OAuth client, per server and authorization server, shared by every user. */
  getClient(server: string, issuer: string): Promise<string | null>;
  putClient(server: string, issuer: string, value: string): Promise<void>;
  /** A connect flow on its way, kept until it's taken or `expiresAt` (epoch ms) passes. */
  putFlow(state: string, value: string, expiresAt: number): Promise<void>;
  /** Removes and returns a flow, once: null when there's none, or it has expired. */
  takeFlow(state: string): Promise<string | null>;
}

/** The methods a `CredentialStore` has, to check one an app passes. */
export const STORE_METHODS = ["get", "put", "delete", "list", "lease", "getClient", "putClient", "putFlow", "takeFlow"] as const;

/** The most flows `memoryCredentialStore` keeps: past it, the oldest goes. */
const MEMORY_FLOWS = 10_000;

/**
 * Credentials in this process's memory. Gone on a restart, and not shared:
 * with several servers, use `pgCredentialStore`. Keeps the latest 10,000
 * flows on their way.
 */
export function memoryCredentialStore(): CredentialStore {
  const credentials = new Map<string, Map<string, string>>();
  /** Each credential's refresh lease, by user and server. */
  const leases = new Map<string, { holder: string; until: number }>();
  const clients = new Map<string, string>();
  const flows = new Map<string, { value: string; expiresAt: number }>();
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  return {
    async get(userId, server) {
      return credentials.get(userId)?.get(server) ?? null;
    },
    async put(userId, server, value, previous) {
      const servers = credentials.get(userId) ?? new Map<string, string>();
      if ((servers.get(server) ?? null) !== previous) return false;
      servers.set(server, value);
      credentials.set(userId, servers);
      leases.delete(key(userId, server));
      return true;
    },
    async delete(userId, server, previous) {
      const servers = credentials.get(userId);
      if (!servers) return;
      if (server === undefined) {
        for (const name of servers.keys()) leases.delete(key(userId, name));
        credentials.delete(userId);
        return;
      }
      if (previous !== undefined && servers.get(server) !== previous) return;
      servers.delete(server);
      leases.delete(key(userId, server));
      if (!servers.size) credentials.delete(userId);
    },
    async list(userId) {
      return [...(credentials.get(userId)?.keys() ?? [])];
    },
    async lease(userId, server, previous, holder, ms) {
      if (credentials.get(userId)?.get(server) !== previous) return false;
      const now = Date.now();
      const held = leases.get(key(userId, server));
      if (held && held.until > now && held.holder !== holder) return false;
      leases.set(key(userId, server), { holder, until: now + ms });
      return true;
    },
    async getClient(server, issuer) {
      return clients.get(key(server, issuer)) ?? null;
    },
    async putClient(server, issuer, value) {
      clients.set(key(server, issuer), value);
    },
    async putFlow(state, value, expiresAt) {
      const now = Date.now();
      // the oldest first: past their time, or past the most kept
      for (const [old, flow] of flows) {
        if (flow.expiresAt > now && flows.size < MEMORY_FLOWS) break;
        flows.delete(old);
      }
      flows.set(state, { value, expiresAt });
    },
    async takeFlow(state) {
      const flow = flows.get(state);
      flows.delete(state);
      return flow && flow.expiresAt > Date.now() ? flow.value : null;
    },
  };
}
