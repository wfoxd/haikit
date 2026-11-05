import http from "node:http";
import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server";

// What the stand-in services share: a server of their own on 127.0.0.1, and
// an MCP handler answered from node:http.

/** Listens on a free port of 127.0.0.1, so a service never takes one the app or anything else wants. */
export async function listen(handle: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) {
  const server = http.createServer((req, res) =>
    handle(req, res).catch((err) => {
      console.error("[hello-mcp] a service's request failed:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function bodyOf(req: http.IncomingMessage): Promise<string> {
  // decoded as a stream, so a character split between two chunks comes through whole
  req.setEncoding("utf8");
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65_536) break;
  }
  return text;
}

export function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

/** The token of an `Authorization: Bearer` header, or null. */
export const bearerOf = (req: http.IncomingMessage) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;

/** Answers a request, whose body has been read already, with an MCP handler, for the caller `authInfo` names. */
export async function serveMcp(handler: McpHttpHandler, req: http.IncomingMessage, res: http.ServerResponse, body: string, authInfo: AuthInfo) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: body || undefined });
  const response = await handler.fetch(request, { authInfo });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
}

export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
