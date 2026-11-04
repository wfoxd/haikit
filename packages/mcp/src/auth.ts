import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthProvider, FetchLike, OAuthClientProvider } from "@modelcontextprotocol/client";
import { LookupFailed, Lookup, NeedsAuth, type Credential } from "./credential.js";
import { OAuthServer, isSecure, type OAuthCore, type OAuthServerOptions } from "./oauth.js";
import { routes } from "./routes.js";
import { SECRET_BYTES, Sealer } from "./seal.js";
import { STORE_METHODS, type CredentialStore } from "./store.js";

export { LookupFailed, Mismatch, NeedsAuth, type Credential } from "./credential.js";
export type { OAuthServerOptions } from "./oauth.js";

export interface McpAuthOptions {
  /**
   * Who a conversation belongs to: the user a call made in it runs as. With
   * @haikit/auth, `(id) => auth.ownerOf(id)`. `null` for no one.
   */
  userOf(conversationId: string): string | null | Promise<string | null>;
  /**
   * Where each user's OAuth credentials are kept, sealed:
   * `memoryCredentialStore()`, or `pgCredentialStore(db)` from
   * `@haikit/mcp/postgres`. With `secret` and `redirectUri`, for `oauth()`.
   */
  store?: CredentialStore;
  /**
   * Seals every credential at rest. Several: the first seals, and every one
   * opens, so a secret can be rotated out. Each at least 32 bytes.
   */
  secret?: string | string[];
  /**
   * Where an authorization server sends the browser back, exactly as
   * registered with it: its path is the callback route. https, except on
   * localhost.
   */
  redirectUri?: string;
  /**
   * The signed-in user a request to the routes comes from, or `null`. With
   * @haikit/auth, `async (req) => (await auth.user(req))?.id ?? null`. For
   * `handler()`.
   */
  requestUser?(req: IncomingMessage): string | null | Promise<string | null>;
  /**
   * A user has connected an account, at the callback route. With the
   * conversation the connect link was for, if they own it. What it throws is
   * logged: the user is connected all the same.
   */
  onConnected?(connected: McpConnected): void | Promise<void>;
  /** Where `handler()`'s routes are, and the connect links point. Default `"/mcp"`. */
  basePath?: string;
  /** The app's name, which an authorization server shows when the user connects. Default: the redirect URI's host. */
  clientName?: string;
}

/** What `onConnected` is told. */
export interface McpConnected {
  userId: string;
  server: string;
  /** The conversation the connect link was for: only one the user owns. */
  conversationId?: string;
}

/** A server a user has connected an account for, from `connections()`. */
export interface McpAccount {
  /** The server's `name`. */
  name: string;
  /** The scope granted, or asked for when the authorization server didn't say. */
  scope: string | null;
  /** When the user connected, epoch ms. */
  connectedAt: number;
}

/** Makes the `auth` of servers whose calls are made as each user. */
export interface McpAuth {
  /**
   * Each user's own token, which the app already has: `token(userId)` gives
   * it, or `null` when the user has none. Sent as `Authorization: Bearer`.
   */
  bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
  /**
   * Each user connects their account through the connect route, and the
   * store keeps their tokens. Needs `store`, `secret` and `redirectUri`.
   */
  oauth(options?: OAuthServerOptions): McpServerAuth;
  /**
   * One of the SDK's own providers, made for each user: `make(userId)` gives
   * it, or `null` when the user has none. The app owns the whole provider:
   * nothing is stored, and there's no connect route.
   */
  sdk(make: (userId: string) => AuthProvider | OAuthClientProvider | null | Promise<AuthProvider | OAuthClientProvider | null>): McpServerAuth;
  /**
   * The routes, under `basePath`: connect, the callback at the redirect URI's
   * path, disconnect, the user's connections, and the client metadata
   * document. Resolves false for anything else. Needs `requestUser`.
   */
  handler(): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  /** The `oauth()` servers a user has connected an account for. */
  connections(userId: string): Promise<McpAccount[]>;
  /**
   * Revokes a user's tokens for a server where its authorization server takes
   * it, deletes them, and closes the user's connection; with no `server`, for
   * every server they connected.
   */
  disconnect(userId: string, server?: string): Promise<void>;
}

/** How a server's calls are made as each user: made by an `McpAuth`, and given to `mcpServer({ auth })`. */
export interface McpServerAuth {
  readonly kind: "bearer" | "oauth" | "sdk";
}

/** What a server tells its `McpAuth` of itself. */
export interface Attached {
  name: string;
  timeoutMs: number;
  url: URL;
  fetch: FetchLike | undefined;
  forget(userId: string): Promise<void>;
}

/** A server's place on its `McpAuth`. */
export interface Binding {
  /** The user's credential, for a new connection of theirs. */
  credential(userId: string): Credential;
  /** The connect route's path, for an `oauth()` server: for this conversation, and asking for `scope`. */
  readonly connect: ((conversationId: string | undefined, scope: string | undefined) => string) | null;
  /** Frees the name, for a closed server. */
  detach(): void;
}

/** What an `McpServerAuth` stands for. */
export interface AuthConfig {
  readonly kind: McpServerAuth["kind"];
  userOf(conversationId: string): string | null | Promise<string | null>;
  /** Takes the server's name on this `McpAuth`, or throws if another server has it: the name keys its users' credentials. */
  attach(server: Attached): Binding;
}

const configs = new WeakMap<object, AuthConfig>();

/** The config an `McpServerAuth` stands for, or undefined if `createMcpAuth` didn't make it. */
export const configOf = (auth: unknown): AuthConfig | undefined =>
  typeof auth === "object" && auth !== null ? configs.get(auth) : undefined;

const BASE_PATH = /^(\/[A-Za-z0-9\-._~!$&'()*+,;=:@%]+)+$/;
/** What `handler()` answers under `basePath` itself. */
const ROUTES = ["connect", "disconnect", "connections", "client.json"];

/**
 * For servers whose calls are made as each user, with that user's own
 * credential: `mcpServer({ auth: mcpAuth.oauth() })`.
 */
export function createMcpAuth(options: McpAuthOptions): McpAuth {
  if (typeof options?.userOf !== "function") {
    throw new TypeError("createMcpAuth: userOf must be a function, such as (id) => auth.ownerOf(id)");
  }
  for (const name of ["requestUser", "onConnected"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "function") throw new TypeError(`createMcpAuth: ${name} must be a function`);
  }
  const basePath = options.basePath ?? "/mcp";
  if (typeof basePath !== "string" || !BASE_PATH.test(basePath)) {
    throw new TypeError(`createMcpAuth: basePath must be a path such as "/mcp", with no trailing slash (got ${JSON.stringify(basePath)})`);
  }
  const core = oauthCore(options, basePath);

  /** Every server attached, by name: its kind, and its OAuth if it has one. */
  const servers = new Map<string, { forget(userId: string): Promise<void>; oauth: OAuthServer | null }>();
  const userOf = (conversationId: string) => options.userOf(conversationId);

  function make(kind: McpServerAuth["kind"], bind: (server: Attached) => Omit<Binding, "detach">): McpServerAuth {
    const auth: McpServerAuth = Object.freeze({ kind });
    configs.set(auth, {
      kind,
      userOf,
      attach(server) {
        if (servers.has(server.name)) throw new TypeError(`another server from the same createMcpAuth is named "${server.name}"`);
        const bound = bind(server);
        const entry = { forget: server.forget, oauth: bound instanceof OAuthBinding ? bound.oauth : null };
        servers.set(server.name, entry);
        return {
          credential: (user) => bound.credential(user),
          connect: bound.connect,
          detach: () => {
            if (servers.get(server.name) === entry) servers.delete(server.name);
          },
        };
      },
    });
    return auth;
  }

  const needsStore = (what: string) => {
    if (!core) throw new TypeError(`${what} needs createMcpAuth({ store, secret, redirectUri })`);
    return core;
  };

  return Object.freeze({
    bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth {
      if (typeof token !== "function") {
        throw new TypeError("bearer: token must be a function that takes a user id and returns their token, or null");
      }
      return make("bearer", (server) => ({
        credential: (user: string) => new BearerCredential(token, user, server.timeoutMs),
        connect: null,
      }));
    },

    oauth(oauthOptions: OAuthServerOptions = {}): McpServerAuth {
      const ready = needsStore("oauth()");
      const checked = checkOAuth(oauthOptions);
      return make("oauth", (server) => new OAuthBinding(new OAuthServer(ready, checked, server.name, server.url, server.fetch ?? fetch, server.timeoutMs, server.forget), basePath));
    },

    sdk(makeProvider: (userId: string) => ProviderOrNull | Promise<ProviderOrNull>): McpServerAuth {
      if (typeof makeProvider !== "function") {
        throw new TypeError("sdk: make must be a function that takes a user id and returns their AuthProvider, or null");
      }
      return make("sdk", (server) => ({
        credential: (user: string) => new SdkCredential(makeProvider, user, server.timeoutMs),
        connect: null,
      }));
    },

    handler() {
      const ready = needsStore("handler()");
      if (!options.requestUser) throw new TypeError("handler() needs createMcpAuth's requestUser: its routes act for the user signed in");
      const requestUser = options.requestUser;
      return routes({
        core: ready,
        basePath,
        requestUser: async (req) => nonEmpty(await requestUser(req)),
        userOf: async (id) => nonEmpty(await options.userOf(id)),
        onConnected: options.onConnected,
        oauth: (name) => servers.get(name)?.oauth ?? undefined,
        connections,
        disconnect,
      });
    },

    connections,
    disconnect,
  });

  async function connections(userId: string): Promise<McpAccount[]> {
    const ready = needsStore("connections()");
    if (typeof userId !== "string" || userId === "") throw new TypeError("connections() needs a userId");
    const accounts: McpAccount[] = [];
    for (const name of await ready.store.list(userId)) {
      const held = await servers.get(name)?.oauth?.read(userId);
      if (held) accounts.push({ name, scope: held.kept.scope, connectedAt: held.kept.connectedAt });
    }
    return accounts;
  }

  async function disconnect(userId: string, server?: string): Promise<void> {
    const ready = needsStore("disconnect()");
    if (typeof userId !== "string" || userId === "") throw new TypeError("disconnect() needs a userId");
    if (server !== undefined && (typeof server !== "string" || server === "")) throw new TypeError("disconnect(): server must be a server's name");
    for (const name of server === undefined ? await ready.store.list(userId) : [server]) {
      const oauth = servers.get(name)?.oauth;
      if (oauth) await oauth.disconnect(userId);
      // a server no longer configured: nothing to revoke with, or close
      else await ready.store.delete(userId, name);
    }
  }
}

/** An `oauth()` server's place on its `McpAuth`. */
class OAuthBinding {
  constructor(
    readonly oauth: OAuthServer,
    private readonly basePath: string,
  ) {}

  credential(user: string): Credential {
    return this.oauth.credential(user);
  }

  readonly connect = (conversationId: string | undefined, scope: string | undefined): string => {
    const query = new URLSearchParams();
    if (conversationId !== undefined) query.set("conversation", conversationId);
    if (scope !== undefined) query.set("scope", scope);
    const search = query.toString();
    return `${this.basePath}/connect/${encodeURIComponent(this.oauth.name)}${search ? `?${search}` : ""}`;
  };
}

/** What `oauth()` needs of `createMcpAuth`'s options, checked: null if none of it is given. */
function oauthCore(options: McpAuthOptions, basePath: string): OAuthCore | null {
  const { store, secret, redirectUri } = options;
  if (store === undefined && secret === undefined && redirectUri === undefined) return null;
  if (store === undefined || secret === undefined || redirectUri === undefined) {
    throw new TypeError("createMcpAuth: store, secret and redirectUri go together: oauth() needs all three");
  }
  if (typeof store !== "object" || store === null || STORE_METHODS.some((m) => typeof store[m] !== "function")) {
    throw new TypeError("createMcpAuth: store must be a CredentialStore, such as memoryCredentialStore()");
  }
  const secrets = [secret].flat();
  if (!secrets.length || secrets.some((s) => typeof s !== "string")) throw new TypeError("createMcpAuth: secret must be a string, or a list of them");
  if (secrets.some((s) => Buffer.byteLength(s) < SECRET_BYTES)) throw new TypeError(`createMcpAuth: each secret must be at least ${SECRET_BYTES} bytes`);
  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new TypeError("createMcpAuth: redirectUri must be a URL, such as https://app.example.com/mcp/callback");
  }
  if (!isSecure(callback)) throw new TypeError("createMcpAuth: redirectUri must be https, except on localhost");
  if (callback.hash || callback.search) throw new TypeError("createMcpAuth: redirectUri can't have a query or a fragment");
  const path = callback.pathname;
  if (ROUTES.some((route) => path === `${basePath}/${route}` || path.startsWith(`${basePath}/${route}/`))) {
    throw new TypeError(`createMcpAuth: redirectUri comes back to ${path}, a route handler() answers already`);
  }
  const clientName = options.clientName ?? callback.host;
  if (typeof clientName !== "string" || clientName === "") throw new TypeError("createMcpAuth: clientName must be a non-empty string");
  return {
    store,
    sealer: new Sealer(secrets),
    redirectUri: callback.href,
    clientMetadata: {
      client_name: clientName,
      redirect_uris: [callback.href],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    // the SDK refuses a client identified by a URL that isn't https: on localhost, it registers one
    clientMetadataUrl: callback.protocol === "https:" ? new URL(`${basePath}/client.json`, callback).href : undefined,
  };
}

function checkOAuth(options: OAuthServerOptions): OAuthServerOptions {
  if (typeof options !== "object" || options === null) throw new TypeError("oauth: options must be an object");
  const { issuer, scopes, client } = options;
  if (issuer !== undefined) {
    if (typeof issuer !== "string" || !URL.canParse(issuer)) throw new TypeError("oauth: issuer must be the authorization server's issuer URL");
    if (!isSecure(issuer)) throw new TypeError("oauth: issuer must be https, except on localhost");
  }
  if (scopes !== undefined && (!Array.isArray(scopes) || scopes.some((s) => typeof s !== "string" || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s)))) {
    throw new TypeError("oauth: scopes must be a list of OAuth scopes, such as [\"repo\"], each without spaces");
  }
  if (client !== undefined) {
    if (typeof client?.id !== "string" || client.id === "" || (client.secret !== undefined && typeof client.secret !== "string")) {
      throw new TypeError("oauth: client must be { id, secret? }, as registered with the authorization server");
    }
    if (issuer === undefined) throw new TypeError("oauth: a client needs the issuer it was registered with");
  }
  return Object.freeze({ ...options, ...(scopes ? { scopes: [...scopes] } : {}), ...(client ? { client: { ...client } } : {}) });
}

type ProviderOrNull = AuthProvider | OAuthClientProvider | null;

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A token from `bearer`'s function, kept until a lookup on a 401 finds another, or none. */
export class BearerCredential implements Credential {
  private token: string | null = null;
  /** The lookup on its way, which every caller shares: only it sets `token`. */
  private looking: Promise<string | null> | null = null;
  /** Bounds `read`: a lookup that never answers would hold up every call after it. */
  private readonly lookups: Lookup;

  constructor(
    private readonly read: (userId: string) => string | null | Promise<string | null>,
    private readonly user: string,
    /** How long `read` may take. */
    timeoutMs: number,
  ) {
    this.lookups = new Lookup(timeoutMs, "token");
  }

  async ensure(): Promise<void> {
    if (this.token === null) await this.look();
    if (this.token === null) throw new NeedsAuth("connect");
  }

  close(): void {
    this.lookups.stop();
  }

  // The transport asks for the token before every request, and on a 401
  // calls onUnauthorized, then tries once more with what it finds.
  readonly provider: AuthProvider = {
    // A request is never sent without the user's token: the transport would
    // send it with no Authorization at all. Gone since its call began, as
    // when another call's 401 found none, it stops the request here.
    token: async () => {
      if (this.token === null) throw new NeedsAuth("reconnect");
      return this.token;
    },
    onUnauthorized: async () => {
      // A token the server still refuses gets its 401 on the retry, and is
      // kept: the next 401 looks again. Forgetting it would throw away a
      // newer one that another call's 401 found meanwhile.
      if ((await this.look()) === null) throw new NeedsAuth("reconnect");
    },
  };

  /** One lookup at a time, for first calls and 401s that come together, so none overwrites another's token. */
  private look(): Promise<string | null> {
    this.looking ??= this.lookup()
      .then((token) => (this.token = token))
      .finally(() => {
        this.looking = null;
      });
    return this.looking;
  }

  private async lookup(): Promise<string | null> {
    let token: unknown;
    try {
      token = await this.lookups.run(() => this.read(this.user));
    } catch (err) {
      throw new LookupFailed(err);
    }
    return typeof token === "string" && token !== "" ? token : null;
  }
}

/** A provider from `sdk()`'s function, made once for each connection: the app's provider does the rest. */
class SdkCredential implements Credential {
  private made: AuthProvider | OAuthClientProvider | null = null;
  private looking: Promise<void> | null = null;
  private readonly lookups: Lookup;

  constructor(
    private readonly make: (userId: string) => ProviderOrNull | Promise<ProviderOrNull>,
    private readonly user: string,
    timeoutMs: number,
  ) {
    this.lookups = new Lookup(timeoutMs, "provider");
  }

  async ensure(): Promise<void> {
    if (this.made === null) {
      this.looking ??= this.lookups
        .run(() => this.make(this.user))
        .then(
          (made) => {
            this.made = typeof made === "object" && made !== null ? made : null;
          },
          (err) => {
            throw new LookupFailed(err);
          },
        )
        .finally(() => {
          this.looking = null;
        });
      await this.looking;
    }
    if (this.made === null) throw new NeedsAuth("connect");
  }

  close(): void {
    this.lookups.stop();
  }

  get provider(): AuthProvider | OAuthClientProvider {
    // never asked for before ensure() has made it: a connection dials only after
    if (this.made === null) throw new NeedsAuth("connect");
    return this.made;
  }
}
