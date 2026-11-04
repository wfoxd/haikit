import type { AuthProvider } from "@modelcontextprotocol/client";

export interface McpAuthOptions {
  /**
   * Who a conversation belongs to: the user a call made in it runs as. With
   * @haikit/auth, `(id) => auth.ownerOf(id)`. `null` for no one.
   */
  userOf(conversationId: string): string | null | Promise<string | null>;
}

/** Makes the `auth` of servers whose calls are made as each user. */
export interface McpAuth {
  /**
   * Each user's own token, which the app already has: `token(userId)` gives
   * it, or `null` when the user has none. Sent as `Authorization: Bearer`.
   */
  bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth;
}

/** How a server's calls are made as each user: made by an `McpAuth`, and given to `mcpServer({ auth })`. */
export interface McpServerAuth {
  readonly kind: "bearer";
}

/** What an `McpServerAuth` stands for. */
export interface AuthConfig {
  readonly kind: "bearer";
  userOf(conversationId: string): string | null | Promise<string | null>;
  token(userId: string): string | null | Promise<string | null>;
  /** Server names in use with this `McpAuth`: each is a key for its users' credentials. */
  readonly names: Set<string>;
}

const configs = new WeakMap<object, AuthConfig>();

/** The config an `McpServerAuth` stands for, or undefined if `createMcpAuth` didn't make it. */
export const configOf = (auth: unknown): AuthConfig | undefined =>
  typeof auth === "object" && auth !== null ? configs.get(auth) : undefined;

/**
 * For servers whose calls are made as each user, with that user's own
 * credential: `mcpServer({ auth: mcpAuth.bearer(token) })`.
 */
export function createMcpAuth(options: McpAuthOptions): McpAuth {
  if (typeof options?.userOf !== "function") {
    throw new TypeError("createMcpAuth: userOf must be a function, such as (id) => auth.ownerOf(id)");
  }
  const names = new Set<string>();
  const userOf = (conversationId: string) => options.userOf(conversationId);
  return Object.freeze({
    bearer(token: (userId: string) => string | null | Promise<string | null>): McpServerAuth {
      if (typeof token !== "function") {
        throw new TypeError("bearer: token must be a function that takes a user id and returns their token, or null");
      }
      const auth: McpServerAuth = Object.freeze({ kind: "bearer" });
      configs.set(auth, { kind: "bearer", userOf, token, names });
      return auth;
    },
  });
}

/**
 * The user has no credential, or the server refused theirs: thrown inside a
 * connection, where the transport passes it on unchanged, and made an
 * `McpError` with reason `auth`.
 */
export class NeedsAuth extends Error {
  readonly name = "NeedsAuth";
  constructor(readonly kind: "connect" | "reconnect") {
    super(kind === "connect" ? "the user has no credential" : "the server refused the user's credential");
  }
}

/** The app's lookup of a credential failed: made an `McpError` with reason `connection`. */
export class LookupFailed extends Error {
  readonly name = "LookupFailed";
  constructor(cause: unknown) {
    super("the user's credential could not be looked up", { cause });
  }
}

/** One user's credential for one server, and the `AuthProvider` that sends it. */
export interface Credential {
  /** Before a connection or call: finds the credential, or throws `NeedsAuth("connect")`, so nothing is sent without one. */
  ensure(): Promise<void>;
  /** After the server refused it: the next `ensure()` looks again. */
  forget(): void;
  readonly provider: AuthProvider;
}

/** A token from `bearer`'s function, kept until the server refuses it. */
export class BearerCredential implements Credential {
  private token: string | null = null;
  /** The lookup on its way, which every caller shares: only it sets `token`. */
  private looking: Promise<string | null> | null = null;

  constructor(
    private readonly read: (userId: string) => string | null | Promise<string | null>,
    private readonly user: string,
    /** How long `read` may take: a lookup that never answers would hold up every call after it. */
    private readonly timeoutMs: number,
  ) {}

  async ensure(): Promise<void> {
    if (this.token === null) await this.look();
    if (this.token === null) throw new NeedsAuth("connect");
  }

  forget(): void {
    this.token = null;
  }

  // The transport asks for the token before every request, and on a 401
  // calls onUnauthorized, then tries once more with what it finds.
  readonly provider: AuthProvider = {
    token: async () => this.token ?? undefined,
    onUnauthorized: async () => {
      // a token the server still refuses gets its 401 on the retry, and is
      // forgotten then
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no token within ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    let token: unknown;
    try {
      token = await Promise.race([Promise.resolve().then(() => this.read(this.user)), cut]);
    } catch (err) {
      throw new LookupFailed(err);
    } finally {
      clearTimeout(timer);
    }
    return typeof token === "string" && token !== "" ? token : null;
  }
}
