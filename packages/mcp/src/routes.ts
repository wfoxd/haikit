import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpAccount, McpConnected } from "./auth.js";
import { takeFlow, type OAuthCore, type OAuthServer } from "./oauth.js";

export interface RoutesContext {
  core: OAuthCore;
  basePath: string;
  /** The user signed in, or null. */
  requestUser(req: IncomingMessage): Promise<string | null>;
  userOf(conversationId: string): Promise<string | null>;
  onConnected: ((connected: McpConnected) => void | Promise<void>) | undefined;
  /** The `oauth()` server of this name, if there is one. */
  oauth(name: string): OAuthServer | undefined;
  connections(userId: string): Promise<McpAccount[]>;
  disconnect(userId: string, server?: string): Promise<void>;
}

/** Why the done page says the user isn't connected. */
type Failure = "signed_out" | "access_denied" | "expired" | "refused" | "failed";

/** The done page's one line, for a browser with no opener to tell. */
const LINES: Record<Failure | "ok", string> = {
  ok: "Connected. You can close this window.",
  signed_out: "Not connected: sign in, then try again.",
  access_denied: "Not connected: access wasn't allowed.",
  expired: "Not connected: this link has expired. Try again.",
  refused: "Not connected: you're signed in as someone else.",
  failed: "Not connected: something went wrong. Try again.",
};

/** The done page's one script, which its CSP allows by hash: it tells the window that opened it, at this origin, and closes. */
const SCRIPT =
  'const m=document.getElementById("m");if(window.opener){window.opener.postMessage(JSON.parse(m.dataset.message),location.origin);window.close()}';
const CSP = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'; frame-ancestors 'none'`;

/** The longest `scope` a connect link may ask for. */
const SCOPE_LENGTH = 1_000;
/** RFC 6749's scope: tokens of printable ASCII but `"` and `\`, one space apart. */
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/;
/** The longest `conversation` a connect link may name. */
const CONVERSATION_LENGTH = 512;

const SIGNED_OUT = "sign in to continue";
const CROSS_SITE = "this request came from another site";
const NO_SERVER = "no server of that name connects with OAuth";

type Headers = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function routes(ctx: RoutesContext): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { core, basePath } = ctx;
  const callbackPath = new URL(core.redirectUri).pathname;
  // the redirect URI's origin is this site's, whatever Host a proxy passes on
  const siteOrigin = new URL(core.redirectUri).origin;

  /**
   * Whether a request came from a page of this site, as @haikit/auth checks
   * its sign-out: a browser always sends `Origin` on a POST from a page, and
   * a page can't forge it, nor `Host`. A client that isn't a browser sends
   * no `Origin`, and passes.
   */
  function fromThisSite(headers: Headers): boolean {
    const origin = first(headers.origin);
    if (origin === undefined) {
      const site = first(headers["sec-fetch-site"]);
      return site === undefined || site === "same-origin" || site === "none";
    }
    if (origin === siteOrigin) return true;
    try {
      return new URL(origin).host === first(headers.host);
    } catch {
      return false; // "null", from a sandboxed frame or a file
    }
  }

  /** `GET {basePath}/connect/{server}`: off to the authorization server, with the flow kept meanwhile. */
  async function connect(name: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    const oauth = ctx.oauth(name);
    const user = await ctx.requestUser(req);
    if (user === null) return done(res, oauth && name, "signed_out");
    if (!oauth) return send(res, 404, { error: NO_SERVER });
    let conversation = url.searchParams.get("conversation") || null;
    if (conversation !== null) {
      // kept only for its owner, so a connect wakes no one else's conversation
      try {
        if (conversation.length > CONVERSATION_LENGTH || (await ctx.userOf(conversation)) !== user) conversation = null;
      } catch (err) {
        console.error(`@haikit/mcp: ${name}: the owner of the conversation a connect link names couldn't be looked up, so it's dropped:`, err);
        conversation = null;
      }
    }
    const scope = url.searchParams.get("scope") || undefined;
    if (scope !== undefined && (scope.length > SCOPE_LENGTH || !SCOPE.test(scope))) {
      console.error(`@haikit/mcp: ${name}: a connect link asked for a scope that isn't an OAuth scope`);
      return done(res, name, "failed");
    }
    let to: URL;
    try {
      to = await oauth.start(user, conversation, scope);
    } catch (err) {
      console.error(`@haikit/mcp: ${name}: connecting user ${user} couldn't start:`, err);
      return done(res, name, "failed");
    }
    res.writeHead(303, { location: to.href, "cache-control": "no-store" }).end();
  }

  /** The redirect URI: the code exchanged for the user's tokens, and the done page. */
  async function callback(url: URL, req: IncomingMessage, res: ServerResponse) {
    const state = url.searchParams.get("state");
    // used up whatever comes next, so a link sent to someone else connects no one
    const flow = state ? await takeFlow(core, state) : null;
    if (!flow) return done(res, undefined, "expired");
    const name = flow.server;
    const user = await ctx.requestUser(req);
    if (user === null) return done(res, name, "signed_out");
    if (user !== flow.user) return done(res, name, "refused");
    const error = url.searchParams.get("error");
    if (error === "access_denied") return done(res, name, "access_denied");
    const code = url.searchParams.get("code");
    const oauth = ctx.oauth(name);
    if (error !== null || !code || !oauth) {
      console.error(
        `@haikit/mcp: ${name}: connecting user ${user} failed: ${
          !oauth ? "the server is no longer configured" : error !== null ? `the authorization server answered ${JSON.stringify(error)}` : "the answer has no code"
        }`,
      );
      return done(res, name, "failed");
    }
    try {
      await oauth.finish(flow, code, url.searchParams.get("iss") ?? undefined);
    } catch (err) {
      console.error(`@haikit/mcp: ${name}: connecting user ${user} failed:`, err);
      return done(res, name, "failed");
    }
    if (ctx.onConnected) {
      try {
        await ctx.onConnected({ userId: user, server: name, ...(flow.conversation === null ? {} : { conversationId: flow.conversation }) });
      } catch (err) {
        console.error(`@haikit/mcp: ${name}: onConnected threw, and user ${user} is connected all the same:`, err);
      }
    }
    done(res, name, null);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return false;
    }
    const { pathname } = url;
    const method = req.method;
    const page = async (answer: () => Promise<void>) => {
      try {
        await answer();
      } catch (err) {
        console.error("@haikit/mcp: a request failed:", err);
        if (!res.headersSent) done(res, undefined, "failed");
      }
      return true;
    };
    const api = async (answer: () => Promise<void>) => {
      try {
        await answer();
      } catch (err) {
        // as nodeHandler does: answered and logged, never thrown on to the server
        console.error("@haikit/mcp: a request failed:", err);
        if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    };

    if (pathname === callbackPath && method === "GET") return page(() => callback(url, req, res));
    if (!pathname.startsWith(`${basePath}/`)) return false;
    const rest = pathname.slice(basePath.length + 1);

    if (rest === "connections" && method === "GET") {
      return api(async () => {
        const user = await ctx.requestUser(req);
        if (user === null) return send(res, 401, { error: SIGNED_OUT });
        send(res, 200, { servers: await ctx.connections(user) });
      });
    }
    if (rest === "client.json" && method === "GET" && core.clientMetadataUrl !== undefined) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=3600" });
      res.end(JSON.stringify({ client_id: core.clientMetadataUrl, ...core.clientMetadata }));
      return true;
    }

    const at = rest.indexOf("/");
    const route = rest.slice(0, at);
    const segment = rest.slice(at + 1);
    if (at < 0 || segment === "" || segment.includes("/")) return false;
    let name: string;
    try {
      name = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (route === "connect" && method === "GET") return page(() => connect(name, url, req, res));
    if (route === "disconnect" && method === "POST") {
      return api(async () => {
        if (!fromThisSite(req.headers)) return send(res, 403, { error: CROSS_SITE });
        const user = await ctx.requestUser(req);
        if (user === null) return send(res, 401, { error: SIGNED_OUT });
        if (!ctx.oauth(name)) return send(res, 404, { error: NO_SERVER });
        await ctx.disconnect(user, name);
        res.writeHead(204, { "cache-control": "no-store" }).end();
      });
    }
    return false;
  };
}

/**
 * The done page: it posts `{ type: "haikit:mcp", server, ok, error? }` to
 * the window that opened it, at its own origin, and closes. With no opener,
 * such as a blocked popup, it shows one line and a link back to `/`.
 */
function done(res: ServerResponse, server: string | undefined, failure: Failure | null) {
  const message = { type: "haikit:mcp", ...(server === undefined ? {} : { server }), ok: failure === null, ...(failure === null ? {} : { error: failure }) };
  const line = LINES[failure ?? "ok"];
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(line)}</title></head>` +
      `<body><p id="m" data-message="${escape(JSON.stringify(message))}">${escape(line)}</p><p><a href="/">Back</a></p><script>${SCRIPT}</script></body></html>`,
  );
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
