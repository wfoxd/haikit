import { randomBytes } from "node:crypto";
import {
  OAuthError,
  OAuthErrorCode,
  assertSecureTokenEndpoint,
  auth,
  computeScopeUnion,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  selectClientAuthMethod,
  selectResourceURL,
  type AuthProvider,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { LookupFailed, Lookup, Mismatch, NeedsAuth, type Credential } from "./credential.js";
import { binding, type Sealer } from "./seal.js";
import type { CredentialStore } from "./store.js";

/** How long a connect flow lasts: from the connect route to the callback. */
export const FLOW_MS = 600_000;
/** A refresh lease lasts this many `timeoutMs`: past the refresh request, which `timeoutMs` bounds, and the write after it. */
const LEASE_TIMEOUTS = 2;
/** How often the store is read while another process holds the refresh lease. */
const LEASE_POLL_MS = 250;

/** A wait that doesn't keep the process going. */
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

export interface OAuthServerOptions {
  /**
   * The authorization server this server must use, as its metadata's
   * `issuer`. Strongly advised for a third party's server: a server names its
   * own authorization server, and one compromised could send users to a fake
   * sign-in page.
   */
  issuer?: string;
  /** Asked for when connecting. Default: what the server's metadata asks for. */
  scopes?: string[];
  /**
   * A client the app registered with the authorization server. Needs
   * `issuer`. Without it, one is registered for the app: by its metadata
   * document's URL where the authorization server takes one, else by dynamic
   * client registration.
   */
  client?: { id: string; secret?: string };
}

/** What every `oauth()` server of one `createMcpAuth` shares. */
export interface OAuthCore {
  readonly store: CredentialStore;
  readonly sealer: Sealer;
  readonly redirectUri: string;
  /** What a client is registered with, and the metadata document says. */
  readonly clientMetadata: OAuthClientMetadata;
  /** The metadata document's URL, when the redirect URI is https: an OAuth client can then be identified by it. */
  readonly clientMetadataUrl: string | undefined;
}

/** What a user's credential holds, sealed. */
interface Kept {
  /** As the authorization server issued them, stamped with its `issuer`. */
  tokens: StoredOAuthTokens & { issuer: string };
  /** The client they were issued to: refreshed and revoked as it, whatever the store keeps for new connects. */
  client: StoredOAuthClientInformation;
  /** The scope granted, or asked for when the authorization server didn't say. */
  scope: string | null;
  /** When the user connected, epoch ms. A refresh keeps it. */
  connectedAt: number;
}

/** A credential as the store holds it: the sealed value, and what it opened to. */
interface Held {
  sealed: string;
  kept: Kept;
}

/** A connect flow on its way, sealed in the store under its `state`. */
export interface Flow {
  user: string;
  server: string;
  /** The conversation it came from, if the user owns it: `onConnected` is told. */
  conversation: string | null;
  /** The PKCE verifier. */
  verifier: string;
  /** The client the code is issued to: exchanged as it, though another connect replaced the one the store keeps. */
  client: StoredOAuthClientInformation;
  /** The SDK's discovery state, from the connect route: the callback is bound to its authorization server. */
  discovery: OAuthDiscoveryState;
  /** The scope asked for. */
  scope: string | null;
  expiresAt: number;
}

/** A server's authorization server, as discovered and checked. */
interface Where {
  url: string;
  issuer: string;
  metadata: AuthorizationServerMetadata | undefined;
  /** The RFC 8707 resource indicator: tokens are bound to this server. */
  resource: string | undefined;
}

/** What a refresh refused for good: the user must connect again. */
const REFUSED = new Set<string>([OAuthErrorCode.InvalidGrant, OAuthErrorCode.InvalidClient, OAuthErrorCode.UnauthorizedClient]);

/** Loopback hosts, exempt from https: what the SDK exempts, and RFC 8252 does. */
export const isLoopback = (host: string) =>
  host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host === "::1";

/** https, or http on this machine. */
export const isSecure = (url: string | URL) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && isLoopback(hostname));
  } catch {
    return false;
  }
};

/** The same authorization server: one trailing slash apart at most, as the SDK allows. */
const sameIssuer = (a: string, b: string) => a === b || a === `${b}/` || b === `${a}/`;

/** The connect flow a `state` names, once: null if there's none, it has expired, or it doesn't open. */
export async function takeFlow(core: OAuthCore, state: string): Promise<Flow | null> {
  const sealed = await core.store.takeFlow(state);
  if (sealed === null) return null;
  const flow = core.sealer.open(sealed, binding.flow(state)) as Partial<Flow> | null;
  if (
    typeof flow?.user !== "string" ||
    typeof flow.server !== "string" ||
    typeof flow.verifier !== "string" ||
    typeof flow.client?.client_id !== "string" ||
    typeof flow.discovery?.authorizationServerUrl !== "string" ||
    typeof flow.expiresAt !== "number" ||
    flow.expiresAt <= Date.now()
  ) {
    return null;
  }
  return flow as Flow;
}

/**
 * One server's OAuth: its connect route and callback, each user's
 * credential, refreshing, and revoking on disconnect.
 */
export class OAuthServer {
  /** The authorization server, discovered on the first refresh or revocation, or seeded by a callback. */
  private found: Promise<Where> | null = null;
  /** Each user's refresh on its way, which every 401 of theirs shares until it settles. */
  private readonly refreshing = new Map<string, Promise<Held>>();

  constructor(
    readonly core: OAuthCore,
    private readonly options: OAuthServerOptions,
    readonly name: string,
    private readonly url: URL,
    private readonly baseFetch: FetchLike,
    readonly timeoutMs: number,
    /** Closes the user's connection to this server, so their next call dials with what's stored now. */
    readonly forget: (userId: string) => Promise<void>,
  ) {}

  /** Every request to the authorization server, bounded by `timeoutMs`. */
  readonly fetch: FetchLike = (url, init) => {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return this.baseFetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };

  credential(user: string): Credential {
    return new OAuthCredential(this, user);
  }

  /** A user's credential as the store holds it, or null if there's none, or none that opens. */
  async read(user: string): Promise<Held | null> {
    const sealed = await this.core.store.get(user, this.name);
    if (sealed === null) return null;
    const kept = this.core.sealer.open(sealed, binding.credential(user, this.name)) as Kept | null;
    if (
      typeof kept?.tokens?.access_token !== "string" ||
      typeof kept.tokens.issuer !== "string" ||
      typeof kept.client?.client_id !== "string" ||
      typeof kept.connectedAt !== "number"
    ) {
      console.error(`@haikit/mcp: ${this.name}: the credential of user ${user} doesn't open: sealed with a secret that's gone, or for another row`);
      return null;
    }
    return { sealed, kept };
  }

  seal(user: string, kept: Kept): string {
    return this.core.sealer.seal(kept, binding.credential(user, this.name));
  }

  /** The client configured, stamped with the pinned issuer: the SDK refuses it for any other. */
  private configured(): StoredOAuthClientInformation | undefined {
    const { client, issuer } = this.options;
    return client && { client_id: client.id, ...(client.secret === undefined ? {} : { client_secret: client.secret }), issuer: issuer! };
  }

  /**
   * The client to connect with at an authorization server: the one
   * configured, or the one registered for the app. One registered for
   * another redirect URI or metadata document, or that doesn't open, is no
   * use, and is registered again.
   */
  private async client(issuer: string): Promise<StoredOAuthClientInformation | undefined> {
    const configured = this.configured();
    if (configured) return configured;
    const sealed = await this.core.store.getClient(this.name, issuer);
    if (sealed === null) return undefined;
    const info = this.core.sealer.open(sealed, binding.client(this.name, issuer)) as StoredOAuthClientInformation | null;
    if (typeof info?.client_id !== "string") return undefined;
    const fits =
      "redirect_uris" in info && Array.isArray(info.redirect_uris)
        ? info.redirect_uris.includes(this.core.redirectUri)
        : info.client_id === this.core.clientMetadataUrl;
    return fits ? info : undefined;
  }

  /** The client a flow or credential was issued to, as it's sent: the configured one with its secret as configured now. */
  issuedTo(client: StoredOAuthClientInformation): StoredOAuthClientInformation {
    return this.options.client?.id === client.client_id ? this.configured()! : client;
  }

  private async saveClient(issuer: string, info: StoredOAuthClientInformation): Promise<void> {
    await this.core.store.putClient(this.name, issuer, this.core.sealer.seal(info, binding.client(this.name, issuer)));
  }

  /**
   * Checks what discovery found: the pinned issuer, and an authorization
   * endpoint the browser can be sent to. Called by the SDK straight after
   * discovery, before it looks up or registers a client, so a server that
   * names another authorization server gets nothing from the app.
   */
  async check(state: OAuthDiscoveryState): Promise<Where> {
    const metadata = state.authorizationServerMetadata;
    const issuer = metadata?.issuer ?? String(state.authorizationServerUrl);
    const pinned = this.options.issuer;
    if (pinned !== undefined && !sameIssuer(issuer, pinned)) {
      throw new Mismatch(`${this.name} names ${JSON.stringify(issuer)} as its authorization server, not ${JSON.stringify(pinned)}`);
    }
    const endpoint = metadata?.authorization_endpoint ?? new URL("/authorize", state.authorizationServerUrl).href;
    if (!isSecure(endpoint)) throw new Mismatch(`${this.name}'s authorization server signs users in at ${JSON.stringify(endpoint)}, which isn't https`);
    // the indicator as the metadata has it, as the SDK's auth() sends it
    const selected = await selectResourceURL(this.url, {} as OAuthClientProvider, state.resourceMetadata);
    const resource = selected && state.resourceMetadata ? state.resourceMetadata.resource : selected?.href;
    return { url: String(state.authorizationServerUrl), issuer, metadata, resource };
  }

  /**
   * The authorization server, which must be the one that issued a credential:
   * found again once if it isn't, in case the server moved since.
   */
  async where(issuer: string, resourceMetadataUrl?: URL): Promise<Where> {
    for (let fresh = false; ; fresh = true) {
      this.found ??= discoverOAuthServerInfo(this.url, { fetchFn: this.fetch, ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}) })
        .then((info) => this.check(info))
        .catch((err) => {
          this.found = null;
          throw err;
        });
      const where = await this.found;
      if (sameIssuer(where.issuer, issuer)) return where;
      this.found = null;
      if (fresh) throw new Mismatch(`${this.name} now names ${JSON.stringify(where.issuer)} as its authorization server, not ${JSON.stringify(issuer)}, which issued the credential`);
    }
  }

  /**
   * The connect route: where to send the browser, with the flow stored under
   * its `state` meanwhile. The SDK's `auth()` discovers the authorization
   * server, registers a client if none is kept, and makes the PKCE challenge.
   */
  async start(user: string, conversation: string | null, asked: string | undefined): Promise<URL> {
    const { core } = this;
    const state = randomBytes(32).toString("base64url");
    let discovery: OAuthDiscoveryState | undefined;
    let verifier: string | undefined;
    let to: URL | undefined;
    // the client the code is issued to: the one auth() is given, or the one it registers
    let client: StoredOAuthClientInformation | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: core.redirectUri,
      clientMetadata: core.clientMetadata,
      ...(core.clientMetadataUrl === undefined ? {} : { clientMetadataUrl: core.clientMetadataUrl }),
      clientInformation: async (ctx) => (client = await this.client(ctx?.issuer ?? "")),
      // a configured client is never replaced by one registered on the fly
      ...(this.options.client
        ? {}
        : {
            saveClientInformation: async (info, ctx) => {
              client = info;
              await this.saveClient(ctx?.issuer ?? info.issuer ?? "", info);
            },
          }),
      state: () => state,
      // a reconnect starts over, whatever is kept
      tokens: () => undefined,
      saveTokens: () => {
        throw new Error("no tokens are saved before the user comes back");
      },
      redirectToAuthorization: (url) => {
        to = url;
      },
      saveCodeVerifier: (v) => {
        verifier = v;
      },
      codeVerifier: () => {
        throw new Error("no code is exchanged before the user comes back");
      },
      saveDiscoveryState: async (found) => {
        await this.check(found);
        discovery = found;
      },
    };
    const scope = computeScopeUnion(this.options.scopes?.join(" "), asked);
    const result = await auth(provider, { serverUrl: this.url, fetchFn: this.fetch, ...(scope ? { scope } : {}) });
    if (result !== "REDIRECT" || !to || verifier === undefined || !discovery || !client) {
      throw new Error(`the SDK's auth() answered ${result}, with nowhere to send the user`);
    }
    // a configured client's secret isn't kept: it's read from the options when used, so it can be changed
    if (this.options.client) client = { client_id: client.client_id, ...(client.issuer === undefined ? {} : { issuer: client.issuer }) };
    const expiresAt = Date.now() + FLOW_MS;
    const flow: Flow = { user, server: this.name, conversation, verifier, client, discovery, scope: to.searchParams.get("scope"), expiresAt };
    await core.store.putFlow(state, core.sealer.seal(flow, binding.flow(state)), expiresAt);
    return to;
  }

  /**
   * The callback: exchanges the code with the authorization server and as
   * the client the flow was started with, which checks `iss` (RFC 9207)
   * before it asks for any token, stores the credential, and closes the
   * user's connection.
   */
  async finish(flow: Flow, code: string, iss: string | undefined): Promise<void> {
    const where = await this.check(flow.discovery);
    const tokens = await exchangeAuthorization(where.url, {
      metadata: where.metadata,
      clientInformation: this.issuedTo(flow.client),
      authorizationCode: code,
      iss,
      codeVerifier: flow.verifier,
      redirectUri: this.core.redirectUri,
      ...(where.resource ? { resource: where.resource } : {}),
      fetchFn: this.fetch,
    });
    const kept: Kept = { tokens: { ...tokens, issuer: where.issuer }, client: flow.client, scope: tokens.scope ?? flow.scope, connectedAt: Date.now() };
    const sealed = this.seal(flow.user, kept);
    // the newest connect wins over whatever was kept
    let written = false;
    for (let tries = 0; tries < 3 && !written; tries++) {
      written = await this.core.store.put(flow.user, this.name, sealed, await this.core.store.get(flow.user, this.name));
    }
    if (!written) throw new Error("the user's credential kept changing as the new one was written");
    this.found = Promise.resolve(where);
    await this.forget(flow.user);
  }

  /** Revokes the user's tokens where the authorization server takes it, then deletes them and closes the connection. */
  async disconnect(user: string): Promise<void> {
    const held = await this.read(user);
    if (held) {
      try {
        await this.revoke(held.kept);
      } catch (err) {
        console.error(`@haikit/mcp: ${this.name}: the tokens of user ${user} couldn't be revoked, and are deleted anyway:`, err);
      }
    }
    await this.core.store.delete(user, this.name);
    await this.forget(user);
  }

  /** RFC 7009, at the authorization server's revocation endpoint, if it has one. */
  private async revoke(kept: Kept): Promise<void> {
    const { tokens } = kept;
    const where = await this.where(tokens.issuer);
    const endpoint = (where.metadata as { revocation_endpoint?: string } | undefined)?.revocation_endpoint;
    if (!endpoint) return;
    const client = this.issuedTo(kept.client);
    const url = assertSecureTokenEndpoint(endpoint);
    const body = new URLSearchParams(
      tokens.refresh_token ? { token: tokens.refresh_token, token_type_hint: "refresh_token" } : { token: tokens.access_token, token_type_hint: "access_token" },
    );
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", accept: "application/json" });
    const metadata = where.metadata as { revocation_endpoint_auth_methods_supported?: string[]; token_endpoint_auth_methods_supported?: string[] };
    const method = selectClientAuthMethod(client, metadata.revocation_endpoint_auth_methods_supported ?? metadata.token_endpoint_auth_methods_supported ?? []);
    if (method === "client_secret_basic" && client.client_secret !== undefined) {
      // as the SDK's own token requests send it: the authorization server checks the client the same way at both
      headers.set("authorization", `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`);
    } else {
      body.set("client_id", client.client_id);
      if (method === "client_secret_post" && client.client_secret !== undefined) body.set("client_secret", client.client_secret);
    }
    const response = await this.fetch(url, { method: "POST", headers, body, redirect: "error" });
    await response.text().catch(() => {});
    if (!response.ok) throw new Error(`the revocation endpoint answered ${response.status}`);
  }

  /**
   * After a 401: the credential to use instead of `before`. One refresh for
   * each user at a time, shared until it settles, however long that takes,
   * on whichever connection of theirs: a second would spend a refresh token
   * the first may have spent already, and delete the credential when it's
   * refused. Across processes, the store's lease does the same.
   */
  refresh(user: string, before: Held, resourceMetadataUrl: URL | undefined): Promise<Held> {
    let refreshing = this.refreshing.get(user);
    if (!refreshing) {
      refreshing = this.renew(user, before, resourceMetadataUrl)
        .catch((err) => {
          if (err instanceof Mismatch) console.error(`@haikit/mcp: ${this.name}: no refresh for user ${user}: ${err.message}`);
          throw err;
        })
        .finally(() => this.refreshing.delete(user));
      this.refreshing.set(user, refreshing);
    }
    return refreshing;
  }

  /**
   * The store's newer credential if another refresh wrote one, else a
   * refresh of `before`, under the store's lease. A refusal deletes it,
   * unless another write came first; an outage keeps it.
   */
  private async renew(user: string, before: Held, resourceMetadataUrl: URL | undefined): Promise<Held> {
    const moved = await this.newer(user, before);
    if (moved) return moved;
    const { tokens } = before.kept;
    if (!tokens.refresh_token) {
      await this.drop(user, before);
      throw new NeedsAuth("reconnect");
    }
    const where = await this.where(tokens.issuer, resourceMetadataUrl);
    const holder = randomBytes(16).toString("base64url");
    const written = await this.lease(user, before, holder);
    if (written) return written;
    // given back when this refresh writes nothing; a write or delete ends it anyway
    const giveBack = () => this.core.store.lease(user, this.name, before.sealed, holder, 0).catch(() => false);
    let fresh: Awaited<ReturnType<typeof refreshAuthorization>>;
    try {
      fresh = await refreshAuthorization(where.url, {
        metadata: where.metadata,
        clientInformation: this.issuedTo(before.kept.client),
        refreshToken: tokens.refresh_token,
        ...(where.resource ? { resource: where.resource } : {}),
        fetchFn: this.fetch,
      });
    } catch (err) {
      if (err instanceof OAuthError && REFUSED.has(err.code)) {
        // Refused: unless another refresh spent the token first, after this
        // one's lease lapsed, and stored what it got, which is then the one
        // to use.
        const moved = await this.newer(user, before);
        if (moved) return moved;
        await this.drop(user, before);
        throw new NeedsAuth("reconnect");
      }
      // an outage, or an answer that isn't OAuth's: kept, for the next 401 to try
      await giveBack();
      throw new LookupFailed(err);
    }
    const kept: Kept = { ...before.kept, tokens: { ...fresh, issuer: tokens.issuer }, scope: fresh.scope ?? before.kept.scope };
    const sealed = this.seal(user, kept);
    if (await this.core.store.put(user, this.name, sealed, before.sealed)) return { sealed, kept };
    // Another write came first, or a delete, as by a disconnect: the tokens
    // just issued are no one's, so they're revoked rather than left live.
    await this.orphaned(user, kept, tokens.refresh_token);
    const stands = await this.newer(user, before);
    if (stands) return stands;
    await giveBack();
    throw new Error("the store refused a write of what it still holds");
  }

  /**
   * Revokes the tokens a refresh got but couldn't store: its refresh token
   * if the authorization server rotated it, else only its access token, as
   * the one refresh token may be what the store holds now.
   */
  private async orphaned(user: string, kept: Kept, spent: string): Promise<void> {
    const { refresh_token, ...access } = kept.tokens;
    try {
      await this.revoke(refresh_token === spent ? { ...kept, tokens: access } : kept);
    } catch (err) {
      console.error(`@haikit/mcp: ${this.name}: the tokens refreshed for user ${user} weren't stored, and couldn't be revoked:`, err);
    }
  }

  /**
   * Takes the refresh lease of the user's credential, so one process at a
   * time spends its refresh token. While another holds it: the credential
   * that one writes, which is then the one to use, or the lease once it
   * lapses, as it does when that process is gone.
   */
  private async lease(user: string, before: Held, holder: string): Promise<Held | null> {
    const ms = LEASE_TIMEOUTS * this.timeoutMs;
    const giveUp = Date.now() + 2 * ms;
    while (!(await this.core.store.lease(user, this.name, before.sealed, holder, ms))) {
      const moved = await this.newer(user, before);
      if (moved) return moved;
      if (Date.now() >= giveUp) throw new Error(`other processes held the refresh lease for ${2 * ms} ms`);
      await pause(LEASE_POLL_MS);
    }
    return null;
  }

  /** The store's credential if it's newer than `before`, or null if it's still `before`. With none, the server's refusal stands. */
  private async newer(user: string, before: Held): Promise<Held | null> {
    const now = await this.read(user);
    if (now === null) throw new NeedsAuth("reconnect");
    return now.sealed === before.sealed ? null : now;
  }

  /** Deletes the credential, if the store still holds `before`: never a newer one. */
  private async drop(user: string, before: Held): Promise<void> {
    await this.core.store.delete(user, this.name, before.sealed);
  }
}

/**
 * One user's OAuth credential for one server. The transport is given an
 * `AuthProvider` of this package's own, never the SDK's
 * `OAuthClientProvider`: so a call never starts a sign-in or registers a
 * client, refreshes once at a time, and tells an outage from a refusal.
 */
class OAuthCredential implements Credential {
  /** What the store held when this read or wrote it. Only a lookup, a refresh or the store's newer value sets it. */
  private held: Held | null = null;
  /** The lookup on its way, which every caller shares. */
  private looking: Promise<void> | null = null;
  private readonly lookups: Lookup;
  private readonly refreshes: Lookup;

  constructor(
    private readonly server: OAuthServer,
    private readonly user: string,
  ) {
    this.lookups = new Lookup(server.timeoutMs, "credential");
    this.refreshes = new Lookup(server.timeoutMs, "refresh");
  }

  async ensure(): Promise<void> {
    if (this.held === null) await this.look();
    if (this.held === null) throw new NeedsAuth("connect");
  }

  close(): void {
    // A refresh on its way isn't stopped: a provider that rotates refresh
    // tokens has spent the old one, and what it gives back must be stored.
    this.lookups.stop();
  }

  // The transport asks for the token before every request, and on a 401
  // calls onUnauthorized, then tries once more with what it finds.
  readonly provider: AuthProvider = {
    token: async () => {
      // gone since this call began, as when another call's 401 was refused
      if (this.held === null) throw new NeedsAuth("reconnect");
      return this.held.kept.tokens.access_token;
    },
    onUnauthorized: async (ctx) => {
      const before = this.held;
      if (before === null) throw new NeedsAuth("reconnect");
      // held when the refresh settles, though this 401 gave up waiting for it
      const refreshing = this.server.refresh(this.user, before, extractWWWAuthenticateParams(ctx.response).resourceMetadataUrl).then(
        (next) => this.take(before, next),
        (err) => {
          if (err instanceof NeedsAuth) this.take(before, null);
          throw err;
        },
      );
      try {
        await this.refreshes.run(() => refreshing);
      } catch (err) {
        throw err instanceof NeedsAuth || err instanceof Mismatch || err instanceof LookupFailed ? err : new LookupFailed(err);
      }
    },
  };

  private look(): Promise<void> {
    this.looking ??= this.lookups
      .run(() => this.server.read(this.user))
      .then(
        (found) => {
          this.held = found;
        },
        (err) => {
          throw new LookupFailed(err);
        },
      )
      .finally(() => {
        this.looking = null;
      });
    return this.looking;
  }

  /** Holds `next`, unless something newer than `before` is held already, as by a refresh that outlived its wait. */
  private take(before: Held, next: Held | null): void {
    if (this.held === before) this.held = next;
  }
}
