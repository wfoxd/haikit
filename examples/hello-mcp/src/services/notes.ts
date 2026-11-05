import { createHash, randomBytes } from "node:crypto";
import type http from "node:http";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bearerOf, bodyOf, escape, json, listen, serveMcp } from "./http.ts";

/**
 * Notes: a stand-in for a service someone else runs, as GitHub or Linear is,
 * so the example runs offline. Its MCP server takes only the access tokens
 * of its own authorization server, where each user signs in to Notes, and
 * says which that is. Each listens on a port of its own on 127.0.0.1, and the
 * app reaches them only over HTTP, as it would the real ones.
 *
 * The authorization server:
 *   GET  /.well-known/oauth-authorization-server   its metadata (RFC 8414)
 *   POST /register                                 a client registers itself (RFC 7591)
 *   GET  /authorize                                the user signs in to Notes, and allows or denies
 *   POST /token                                    a code for tokens, with PKCE; a refresh, which rotates
 *   POST /revoke                                   a token revoked (RFC 7009)
 *
 * The MCP server:
 *   GET  /.well-known/oauth-protected-resource/mcp which authorization server it takes tokens from (RFC 9728)
 *   POST /mcp                                      list_notes, with notes.read; add_note, with notes.write
 */

const SCOPES = ["notes.read", "notes.write"];
/** What each tool needs. One the token wasn't granted is a 403 that names the scope it needs. */
const NEEDS: Record<string, string> = { list_notes: "notes.read", add_note: "notes.write" };
/** Access tokens last 15 minutes, so a session of any length sees one refreshed. */
const ACCESS_SECONDS = 15 * 60;
const CODE_MS = 60_000;

interface Note {
  id: string;
  text: string;
  createdAt: string;
  key?: string;
}
interface Grant {
  account: string;
  client: string;
  scope: string;
  resource: string;
  /** The authorization this token came from, so revoking a refresh token revokes its access tokens too. */
  grant: string;
}

const random = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
const sameResource = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");

export async function startNotes() {
  /** Each account's notes, newest last. A new account starts with two. */
  const notebooks = new Map<string, Note[]>();
  const clients = new Map<string, { name: string; redirectUris: string[] }>();
  const codes = new Map<string, Grant & { redirectUri: string; challenge: string; expires: number }>();
  const accessTokens = new Map<string, Grant & { expires: number }>();
  const refreshTokens = new Map<string, Grant>();

  function notebookOf(account: string) {
    let notes = notebooks.get(account);
    if (!notes) {
      const at = new Date().toISOString();
      notes = [
        { id: "n1", text: "Buy stamps for the postcards", createdAt: at },
        { id: "n2", text: "Call Sam on Sunday", createdAt: at },
      ];
      notebooks.set(account, notes);
    }
    return notes;
  }

  function mint(grant: Grant) {
    const access = random("notes_at");
    const refresh = random("notes_rt");
    accessTokens.set(access, { ...grant, expires: Date.now() + ACCESS_SECONDS * 1000 });
    refreshTokens.set(refresh, grant);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: grant.scope };
  }

  // ── the MCP server ───────────────────────────────────────────────────
  // A server of the SDK's, made for each request, for the account the token is for.
  const mcp = createMcpHandler(({ authInfo }) => {
    const account = String(authInfo?.extra?.account);
    const server = new McpServer({ name: "notes", version: "1.0.0" });
    const NoteOut = z.object({ id: z.string(), text: z.string(), createdAt: z.string() });
    const out = (note: Note) => ({ id: note.id, text: note.text, createdAt: note.createdAt });
    const reply = <T extends Record<string, unknown>>(value: T) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value });

    server.registerTool(
      "list_notes",
      {
        // the model never reads this, or anything else Notes says about its tools
        description: "Every note of the signed-in account, newest first.",
        inputSchema: z.object({}),
        outputSchema: z.object({ account: z.string(), notes: z.array(NoteOut) }),
      },
      async () => reply({ account, notes: notebookOf(account).toReversed().map(out) }),
    );
    server.registerTool(
      "add_note",
      {
        description: "Adds a note. A note with the key of one already added replaces it, so saving twice keeps one.",
        inputSchema: z.object({ text: z.string().min(1).max(500), key: z.string().max(200).optional() }),
        outputSchema: z.object({ note: NoteOut }),
      },
      async ({ text, key }) => {
        const notes = notebookOf(account);
        const kept = key === undefined ? undefined : notes.find((n) => n.key === key);
        const note = kept ?? { id: `n${notes.length + 1}`, text, createdAt: new Date().toISOString(), key };
        if (kept) kept.text = text;
        else notes.push(note);
        return reply({ note: out(note) });
      },
    );
    return server;
  });

  const rs = await listen(async (req, res) => {
    const url = new URL(req.url ?? "/", rs.origin);
    const resource = `${rs.origin}/mcp`;
    const metadata = `${rs.origin}/.well-known/oauth-protected-resource/mcp`;
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/.well-known/oauth-protected-resource") {
      return json(res, 200, { resource, authorization_servers: [as.origin], scopes_supported: SCOPES, bearer_methods_supported: ["header"], resource_name: "Notes" });
    }
    if (url.pathname !== "/mcp") return void res.writeHead(404).end();

    // only a token of Notes' own, for this server, that hasn't expired
    const token = bearerOf(req);
    const grant = token ? accessTokens.get(token) : undefined;
    if (!grant || grant.expires < Date.now() || !sameResource(grant.resource, resource)) {
      const error = token ? ', error="invalid_token"' : "";
      return json(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${metadata}"${error}` });
    }
    const body = await bodyOf(req);
    let rpc: { method?: string; params?: { name?: string } } | null = null;
    try {
      rpc = body ? JSON.parse(body) : null;
    } catch {}
    const needs = rpc?.method === "tools/call" ? NEEDS[rpc.params?.name ?? ""] : undefined;
    if (needs && !grant.scope.split(" ").includes(needs)) {
      const wanted = [...new Set([...grant.scope.split(" "), needs])].filter((s) => SCOPES.includes(s)).join(" ");
      return json(res, 403, { error: "insufficient_scope" }, { "www-authenticate": `Bearer error="insufficient_scope", scope="${wanted}", resource_metadata="${metadata}"` });
    }
    await serveMcp(mcp, req, res, body, {
      token: token!,
      clientId: grant.client,
      scopes: grant.scope.split(" "),
      expiresAt: Math.floor(grant.expires / 1000),
      extra: { account: grant.account },
    });
  });

  // ── the authorization server ─────────────────────────────────────────
  const as = await listen(async (req, res) => {
    const url = new URL(req.url ?? "/", as.origin);
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: as.origin,
        authorization_endpoint: `${as.origin}/authorize`,
        token_endpoint: `${as.origin}/token`,
        registration_endpoint: `${as.origin}/register`,
        revocation_endpoint: `${as.origin}/revoke`,
        scopes_supported: [...SCOPES, "offline_access"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      });
    }

    // a public client, as the SDK registers one: a name, and where to send the browser back
    if (url.pathname === "/register" && req.method === "POST") {
      let metadata: { client_name?: unknown; redirect_uris?: unknown };
      try {
        metadata = JSON.parse(await bodyOf(req));
      } catch {
        return json(res, 400, { error: "invalid_client_metadata" });
      }
      const uris = metadata.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === "string" && URL.canParse(u))) {
        return json(res, 400, { error: "invalid_redirect_uri" });
      }
      const id = random("notes_client");
      const name = typeof metadata.client_name === "string" ? metadata.client_name : "An app";
      clients.set(id, { name, redirectUris: uris });
      return json(res, 201, {
        ...metadata,
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
      });
    }

    if (url.pathname === "/authorize" && (req.method === "GET" || req.method === "POST")) return authorize(req, res, url);

    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await bodyOf(req));
      const client = form.get("client_id") ?? "";
      if (!clients.has(client)) return json(res, 401, { error: "invalid_client" });
      const grantType = form.get("grant_type");
      if (grantType === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const proof = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        const resource = form.get("resource");
        if (
          !code ||
          code.expires < Date.now() ||
          code.client !== client ||
          code.redirectUri !== form.get("redirect_uri") ||
          code.challenge !== proof ||
          (resource !== null && !sameResource(resource, code.resource))
        ) {
          return json(res, 400, { error: "invalid_grant" });
        }
        const { redirectUri, challenge, expires, ...grant } = code;
        return json(res, 200, mint(grant));
      }
      if (grantType === "refresh_token") {
        // each refresh token is spent by its refresh: the new one replaces it
        const token = form.get("refresh_token") ?? "";
        const grant = refreshTokens.get(token);
        if (!grant || grant.client !== client) return json(res, 400, { error: "invalid_grant" });
        refreshTokens.delete(token);
        return json(res, 200, mint(grant));
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === "/revoke" && req.method === "POST") {
      const token = new URLSearchParams(await bodyOf(req)).get("token") ?? "";
      const refresh = refreshTokens.get(token);
      refreshTokens.delete(token);
      accessTokens.delete(token);
      // a refresh token takes its grant's access tokens with it
      if (refresh) for (const [access, grant] of accessTokens) if (grant.grant === refresh.grant) accessTokens.delete(access);
      return void res.writeHead(200).end();
    }
    res.writeHead(404).end();
  });

  /** The sign-in and consent page, and the answer to it: back to the app, with a code or `access_denied`. */
  async function authorize(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const q = url.searchParams;
    const client = clients.get(q.get("client_id") ?? "");
    const redirectUri = q.get("redirect_uri") ?? "";
    // a client or redirect URI Notes doesn't know: the browser goes nowhere
    if (!client || !client.redirectUris.includes(redirectUri)) return page(res, 400, "<p>This app isn't registered with Notes.</p>");
    const back = (params: Record<string, string>) => {
      const to = new URL(redirectUri);
      for (const [k, v] of Object.entries({ ...params, state: q.get("state") ?? "", iss: as.origin })) to.searchParams.set(k, v);
      res.writeHead(302, { location: to.href, "cache-control": "no-store" }).end();
    };
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
      return back({ error: "invalid_request" });
    }
    const asked = (q.get("scope") ?? SCOPES.join(" ")).split(" ").filter((s) => SCOPES.includes(s));
    const resource = q.get("resource") ?? `${rs.origin}/mcp`;
    if (!sameResource(resource, `${rs.origin}/mcp`)) return back({ error: "invalid_target" });

    if (req.method === "GET") {
      const can = asked.map((s) => (s === "notes.read" ? "read your notes" : "add notes")).join(" and ") || "see that you have an account";
      return page(
        res,
        200,
        `<p><strong>${escape(client.name)}</strong> wants to ${escape(can)}.</p>
         <form method="post">
           <label>Your name at Notes <input name="account" autofocus required maxlength="40" autocomplete="username"></label>
           <button name="decision" value="allow">Allow</button>
           <button name="decision" value="deny" formnovalidate>Deny</button>
         </form>`,
      );
    }
    const form = new URLSearchParams(await bodyOf(req));
    if (form.get("decision") !== "allow") return back({ error: "access_denied" });
    const account = (form.get("account") ?? "").trim();
    if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(account)) return page(res, 400, "<p>A name of 1 to 40 letters, digits, spaces, dots, dashes or underscores.</p>");
    const code = random("notes_code");
    codes.set(code, {
      account,
      client: q.get("client_id")!,
      scope: asked.join(" "),
      resource,
      grant: random("grant"),
      redirectUri,
      challenge: q.get("code_challenge")!,
      expires: Date.now() + CODE_MS,
    });
    back({ code });
  }

  return {
    /** The MCP server's URL, as the app's `http()` is given it. */
    url: `${rs.origin}/mcp`,
    /** The authorization server's issuer, which the app pins. */
    issuer: as.origin,
    close: () => Promise.all([rs.close(), as.close()]).then(() => {}),
  };
}

function page(res: http.ServerResponse, status: number, content: string) {
  // no page may frame this one, so none can trick a click on Allow
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'" });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — Notes</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 28rem; margin: 15vh auto; padding: 0 16px; line-height: 1.5; }
    input, button { font: inherit; padding: 6px 10px; }
    label { display: grid; gap: 4px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>Notes</h1>
  ${content}
  <p>A stand-in for a service of someone else's, run by hello-mcp so it works offline.</p>
</body>
</html>`);
}
