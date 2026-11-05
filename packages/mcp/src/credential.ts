import type { AuthProvider, OAuthClientProvider } from "@modelcontextprotocol/client";

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

/** The app's lookup of a credential failed, or a refresh couldn't be made: made an `McpError` with reason `connection`. */
export class LookupFailed extends Error {
  readonly name = "LookupFailed";
  constructor(cause: unknown) {
    super("the user's credential could not be looked up", { cause });
  }
}

/**
 * The server names another authorization server than the one its `issuer`
 * pins, or than the one that issued a credential: made an `McpError` with
 * reason `protocol`. The pin decides, not the user, so it's never `auth`.
 */
export class Mismatch extends Error {
  readonly name = "Mismatch";
}

/** One user's credential for one server, and the `AuthProvider` that sends it. */
export interface Credential {
  /**
   * Before a connection or call: finds the credential, or throws
   * `NeedsAuth("connect")`, so nothing is sent without one. True when it's
   * now another account than before: the connection made with the old one
   * is made again.
   */
  ensure(): Promise<boolean>;
  /** For a connection being closed: stops a lookup on its way, and its timer. */
  close(): void;
  /** What the transport is given, once `ensure()` has found the credential. */
  readonly provider: AuthProvider | OAuthClientProvider;
}

/**
 * A lookup that takes at most `ms`, and that `stop()` ends at once: one that
 * never answered would hold up every call after it, and its timer would keep
 * the process going.
 */
export class Lookup {
  private stopping: (() => void) | null = null;

  constructor(
    private readonly ms: number,
    /** Names what's looked up, in the errors. */
    private readonly what: string,
  ) {}

  async run<T>(look: () => T | Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no ${this.what} within ${this.ms} ms`)), this.ms);
      this.stopping = () => reject(new Error(`closed while the ${this.what} was being looked up`));
    });
    try {
      return await Promise.race([Promise.resolve().then(look), cut]);
    } finally {
      clearTimeout(timer);
      this.stopping = null;
    }
  }

  stop(): void {
    this.stopping?.();
  }
}
