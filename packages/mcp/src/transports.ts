import {
  StreamableHTTPClientTransport,
  type AuthProvider,
  type FetchLike,
  type StreamableHTTPClientTransportOptions,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/client/stdio";

export interface HttpOptions extends StreamableHTTPClientTransportOptions {
  /** Sent on every request, over any of the same name in `requestInit.headers`. */
  headers?: Record<string, string>;
}

/** What `mcpServer({ auth })` needs to know of a transport `http()` made. */
export interface HttpMade {
  /** It was given an `authProvider` of its own. */
  authProvider: boolean;
  /** It sends an `Authorization` header of its own. */
  authorization: boolean;
  /** The server's URL: the protected resource an `oauth()` server's tokens are for. */
  url: URL;
  /** Its `fetch`, which an `oauth()` server's requests to the authorization server go through too. */
  fetch: FetchLike | undefined;
}

/** The factories `http()` made: only these can carry each user's credential. */
export const madeByHttp = new WeakMap<object, HttpMade>();

/**
 * What a request to the server threw instead of an answer, as when the server
 * can't be reached: the SDK's transport doesn't close for it, so the call
 * that sees it drops the connection.
 */
export const unanswered = new WeakSet<object>();

/**
 * A server at `url`, over Streamable HTTP. Everything but `headers` is the
 * SDK's own `StreamableHTTPClientTransportOptions`, such as an `authProvider`.
 * The URL is checked now, so a bad one fails at startup. For a server with
 * `auth`, each user's connection is given that user's `authProvider`.
 */
export function http(url: string | URL, options: HttpOptions = {}): (authProvider?: AuthProvider) => Transport {
  const target = new URL(url);
  const { headers, ...rest } = options;
  if (headers) {
    const merged = new Headers(rest.requestInit?.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    rest.requestInit = { ...rest.requestInit, headers: merged };
  }
  // the same fetch, marking what a request to the server throws; not one to
  // an authorization server, and not an abort, which was asked for
  const own = rest.fetch;
  const fetch: FetchLike = async (input, init) => {
    try {
      return await (own ?? globalThis.fetch)(input, init);
    } catch (err) {
      if (String(input) !== target.href || init?.signal?.aborted) throw err;
      // a value that can't be marked, such as a string, is carried as a cause
      const thrown = typeof err === "object" && err !== null ? err : new Error(`fetch rejected with ${String(err)}`, { cause: err });
      unanswered.add(thrown);
      throw thrown;
    }
  };
  const make = (authProvider?: AuthProvider) =>
    new StreamableHTTPClientTransport(target, authProvider ? { ...rest, fetch, authProvider } : { ...rest, fetch });
  madeByHttp.set(make, {
    authProvider: rest.authProvider !== undefined,
    authorization: new Headers(rest.requestInit?.headers).has("authorization"),
    url: target,
    fetch: rest.fetch,
  });
  return make;
}

/**
 * A server this process starts, and talks to over its stdin and stdout. Each
 * connection starts a new child; `close()` stops it. Unless `env` is given,
 * the child gets only the SDK's short list of safe variables (such as `HOME`
 * and `PATH`), not this process's environment and the secrets in it.
 */
export function stdio(params: StdioServerParameters): () => Transport {
  return () => new StdioClientTransport(params);
}
