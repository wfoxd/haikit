import { StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/client/stdio";

export interface HttpOptions extends StreamableHTTPClientTransportOptions {
  /** Sent on every request, over any of the same name in `requestInit.headers`. */
  headers?: Record<string, string>;
}

/**
 * A server at `url`, over Streamable HTTP. Everything but `headers` is the
 * SDK's own `StreamableHTTPClientTransportOptions`, such as an `authProvider`.
 * The URL is checked now, so a bad one fails at startup.
 */
export function http(url: string | URL, options: HttpOptions = {}): () => Transport {
  const target = new URL(url);
  const { headers, ...rest } = options;
  if (headers) {
    const merged = new Headers(rest.requestInit?.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    rest.requestInit = { ...rest.requestInit, headers: merged };
  }
  return () => new StreamableHTTPClientTransport(target, rest);
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
