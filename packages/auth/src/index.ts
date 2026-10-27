/**
 * @haikit/auth — who is asking, and which conversations are theirs.
 *
 * Identity is a JWT, verified on every request: one this package signs with
 * the app's secret once the app's own login has checked the user (`signIn`),
 * or one the app's identity provider issues, checked against its JWKS. Either
 * way it names a user, and `gate` lets that user use only the conversations
 * they started (see `Gate` in @haikit/core).
 *
 * Tokens are stateless. The store holds only who owns which conversation, and
 * for a user `revoke` was called on, the time before which their tokens are
 * refused: a JWT can't be recalled, only outlived or refused.
 *
 * A sign-in can also go through a provider, such as Google (`google()` from
 * `@haikit/auth/oidc`): the handler sends the browser there and takes it back,
 * and ends in the same `signIn`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { Gate } from "@haikit/core";
import { EncryptJWT, SignJWT, createRemoteJWKSet, decodeProtectedHeader, errors, jwtDecrypt, jwtVerify, type JWTPayload } from "jose";

export { memoryAuthStore } from "./memory.js";

/**
 * Where ownership and revocations are kept. `memoryAuthStore` for one
 * process; `pgAuthStore` from `@haikit/auth/postgres` for several.
 */
export interface AuthStore {
  /** The user who owns a conversation, or null if none does. */
  getOwner(conversationId: string): Promise<string | null>;
  /**
   * Record a conversation's owner. The same owner again does nothing; another
   * one throws, and the first stays: a conversation never changes hands.
   */
  setOwner(conversationId: string, userId: string): Promise<void>;
  /** The epoch ms before which this user's tokens are refused, or null. */
  getNotBefore(userId: string): Promise<number | null>;
  /** Refuse this user's tokens issued before `at`. A later time wins; an earlier one changes nothing. */
  setNotBefore(userId: string, at: number): Promise<void>;
}

export interface JwtOptions {
  /**
   * Signs the tokens `signIn` issues, with HS256, and verifies them. Several:
   * the first signs, and every one verifies, so a secret can be rotated out.
   * Each at least 32 bytes.
   */
  secret?: string | string[];
  /** An identity provider's JWKS URL: its tokens are verified against the keys there. */
  jwks?: string | URL;
  /** Checked when set: a token must name this issuer. `signIn`'s tokens name it. */
  issuer?: string;
  /** Checked when set: a token must name this audience. `signIn`'s tokens name it. */
  audience?: string | string[];
  /**
   * The algorithms a token may be signed with. Default `["HS256"]` with a
   * secret, and `["RS256", "ES256", "EdDSA"]` with a JWKS. An HS algorithm
   * is only ever checked against the secret, and the rest only against the
   * JWKS, so neither key can stand in for the other.
   */
  algorithms?: string[];
  /** The claim that names the user. Default `"sub"`. Not one every token sets for itself, such as `iss`. */
  userClaim?: string;
  /** How long a token `signIn` issues lasts, and its cookie. Default 7 days. */
  ttlMs?: number;
  /** How far apart the clocks of the issuer and this server may be. Default 5 s; finite, at least 0. */
  clockToleranceMs?: number;
}

export interface CookieOptions {
  /** Default `"__Host-haikit_token"`, or `"haikit_token"` when not `secure`. */
  name?: string;
  /**
   * Default true. False sends the cookie over plain http, for Safari on
   * `http://localhost`, which keeps no `Secure` cookie there. Never in
   * production. A `__Host-` or `__Secure-` name needs it true.
   */
  secure?: boolean;
}

/**
 * Somewhere a user signs in, such as Google: what `google()` and `oidc()` from
 * `@haikit/auth/oidc` return. `handler` sends the browser to it from
 * `GET {basePath}/{name}`, takes it back at the path of `redirectUri`, and
 * signs in the user `finish` names.
 */
export interface SignInProvider {
  /** The route segment: 1 to 32 lowercase letters, digits or dashes, starting with a letter. Not `me` or `sign-out`. */
  readonly name: string;
  /** Where the provider sends the browser back, exactly as registered with it. Its path is the callback route. */
  readonly redirectUri: string;
  /** A path on this site that a sign-in that fails is sent to, with `?sign_in_error=` and why. */
  readonly failureUrl: string;
  /** Where to send the browser, and what `finish` will need, which is kept in the browser's flow cookie meanwhile. */
  start(): Promise<{ url: URL; flow: Record<string, string> }>;
  /**
   * The browser back at `redirectUri`, with what `start` kept: the user who
   * signed in, or why no one did. `access_denied`: the user said no at the
   * provider. `refused`: the app said no to who they are. `expired`: this
   * isn't the answer the flow waits for, such as one to a sign-in in another
   * tab, and the flow is kept for its own. Throws for anything else, which is
   * logged.
   */
  finish(
    callback: URL,
    flow: Record<string, string>,
  ): Promise<{ userId: string; claims?: Record<string, unknown> } | { error: "access_denied" | "refused" | "expired" }>;
}

export interface AuthOptions {
  store: AuthStore;
  jwt: JwtOptions;
  cookie?: CookieOptions;
  /**
   * Origins a POST carrying the cookie may come from, besides the request's
   * own host, such as `"https://app.example.com"`. Behind a proxy that
   * rewrites `Host`, the public origin goes here.
   */
  origins?: string[];
  /** Where else a user can sign in, such as `google()` from `@haikit/auth/oidc`. Needs `jwt.secret`. */
  providers?: SignInProvider[];
}

/** A signed-in user: the id their token names, and everything it says. */
export interface AuthUser {
  id: string;
  claims: Record<string, unknown>;
}

export interface Auth {
  /** Pass to `nodeHandler(hai, basePath, { gate })`. */
  readonly gate: Gate;
  /**
   * `GET {basePath}/me` and `POST {basePath}/sign-out`; and for each
   * provider, `GET {basePath}/{name}` and `GET` its `redirectUri`'s path.
   * Resolves false for anything else.
   */
  handler(basePath?: string): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  /**
   * Once the app's own login has checked the user: issue a token naming them,
   * set it as the cookie, and return it, for a client that sends it as a
   * Bearer token instead. Needs `jwt.secret`.
   */
  signIn(res: ServerResponse, userId: string, claims?: Record<string, unknown>): Promise<string>;
  /** Clear the cookie. A copy of the token stays good until it expires, unless `revoke`d. */
  signOut(res: ServerResponse): void;
  /** The user a token names, if it is valid and not revoked; else null. */
  verify(token: string): Promise<AuthUser | null>;
  /** The user a request's token names, from its Bearer header or the cookie; else null. */
  user(req: IncomingMessage): Promise<AuthUser | null>;
  /** Who owns a conversation: for a tool, `ownerOf(ctx.conversationId)`. */
  ownerOf(conversationId: string): Promise<string | null>;
  /** Make a conversation a user's, such as one started before sign-in existed. */
  claim(conversationId: string, userId: string): Promise<void>;
  /** Refuse every sign-in of this user's before now: here at once, on every server within 30 s. */
  revoke(userId: string): Promise<void>;
}

/** How long a token `signIn` issues lasts: a week. */
const TTL_MS = 604_800_000;
const CLOCK_TOLERANCE_MS = 5_000;
/** How long a user's revocation time is kept here before it is read again. */
const NOT_BEFORE_CACHE_MS = 30_000;
/** The most owners, and revocation times, kept in memory. */
const CACHE_ENTRIES = 10_000;
/** How long a browser has to come back from a provider, and its flow cookie's life. */
const SIGN_IN_FLOW_MS = 600_000;
/** The longest `return_to` kept, percent-encoded. */
const RETURN_TO_LENGTH = 2_048;
/** The most a cookie's name and value may come to: what every browser keeps. A browser's flow cookies stay within it together. */
const COOKIE_BYTES = 4_096;

const SIGNED_OUT = "sign in to continue";
const INVALID = "your sign-in has expired or is invalid";
const NOT_JSON = "the request body must be sent as application/json";
const CROSS_SITE = "this request came from another site";

/** The claims `signIn` sets itself. `auth_time` is when the user signed in, kept by a renewal. */
const REGISTERED = ["iss", "sub", "aud", "exp", "nbf", "iat", "jti", "auth_time"];
const HMAC = ["HS256", "HS384", "HS512"];
/** What jose throws for a token that is bad in itself, rather than for keys it couldn't fetch. */
const TOKEN_FAULTS = [
  errors.JWSSignatureVerificationFailed,
  errors.JWTClaimValidationFailed,
  errors.JWTExpired,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
];
const ASYMMETRIC = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "Ed25519"];
const PROVIDER_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** What `handler` answers at `{basePath}/…` itself. */
const ROUTES = ["me", "sign-out"];

type Headers = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * A path on this site: one `/`, not two, nor a `\`, which a browser reads as
 * one, nor a control character, which it drops; so never another site.
 */
const isLocalPath = (value: unknown): value is string =>
  typeof value === "string" && value.length <= RETURN_TO_LENGTH && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(value);

/**
 * A local path as a `Location` header can carry it: anything outside
 * printable ASCII, which Node refuses in a header, and `"`, which JSON would
 * escape, percent-encoded. Escapes already there are kept as they are.
 */
const forLocation = (path: string) =>
  path.replace(/[^\x21-\x7e]|"/gu, (c) => {
    try {
      return encodeURIComponent(c);
    } catch {
      return "%EF%BF%BD"; // a lone surrogate: U+FFFD, as a URL parser would make it
    }
  });

export function createAuth(options: AuthOptions): Auth {
  const { store, jwt } = options;
  const encoder = new TextEncoder();
  const secrets = (jwt.secret === undefined ? [] : [jwt.secret].flat()).map((s) => encoder.encode(s));
  if (!secrets.length && jwt.jwks === undefined) throw new Error("createAuth: jwt needs a secret, a jwks URL, or both");
  if (secrets.some((s) => s.length < 32)) throw new Error("createAuth: each jwt secret must be at least 32 bytes");
  const algorithms = jwt.algorithms ?? [
    ...(secrets.length ? ["HS256"] : []),
    ...(jwt.jwks !== undefined ? ["RS256", "ES256", "EdDSA"] : []),
  ];
  for (const alg of algorithms) {
    if (alg.toLowerCase() === "none") throw new Error('createAuth: "none" is not an algorithm a token may use');
    if (HMAC.includes(alg)) {
      if (!secrets.length) throw new Error(`createAuth: ${alg} needs jwt.secret`);
    } else if (ASYMMETRIC.includes(alg)) {
      if (jwt.jwks === undefined) throw new Error(`createAuth: ${alg} needs jwt.jwks`);
    } else {
      throw new Error(`createAuth: unknown algorithm ${alg}`);
    }
  }
  const hmac = algorithms.filter((a) => HMAC.includes(a));
  const asymmetric = algorithms.filter((a) => ASYMMETRIC.includes(a));
  if (secrets.length && !hmac.length) throw new Error("createAuth: jwt.secret is given, but jwt.algorithms allows no HS algorithm");

  let keys: ReturnType<typeof createRemoteJWKSet> | null = null;
  if (jwt.jwks !== undefined) {
    let url: URL;
    try {
      url = new URL(jwt.jwks);
    } catch {
      throw new Error("createAuth: jwt.jwks must be a URL");
    }
    keys = createRemoteJWKSet(url);
  }

  const ttlMs = jwt.ttlMs ?? TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000) throw new Error("createAuth: jwt.ttlMs must be at least 1000");
  const userClaim = jwt.userClaim ?? "sub";
  // one every token sets for itself, such as iss, would name every user the same
  if (userClaim !== "sub" && REGISTERED.includes(userClaim)) {
    throw new Error(`createAuth: jwt.userClaim can't be "${userClaim}", a claim every token sets for itself`);
  }
  // NaN or Infinity here would quietly stop exp and nbf being checked at all
  const clockToleranceMs = jwt.clockToleranceMs ?? CLOCK_TOLERANCE_MS;
  if (!Number.isFinite(clockToleranceMs) || clockToleranceMs < 0) {
    throw new Error("createAuth: jwt.clockToleranceMs must be a finite number, at least 0");
  }
  const checks = {
    // jose checks exp only when a token has one: one without would never expire
    requiredClaims: ["exp"],
    clockTolerance: clockToleranceMs / 1000,
    ...(jwt.issuer === undefined ? {} : { issuer: jwt.issuer }),
    ...(jwt.audience === undefined ? {} : { audience: jwt.audience }),
  };

  const secure = options.cookie?.secure ?? true;
  const cookieName = options.cookie?.name ?? (secure ? "__Host-haikit_token" : "haikit_token");
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName)) throw new Error("createAuth: cookie.name isn't a valid cookie name");
  // a browser drops a cookie with either prefix that isn't Secure, so sign-in would seem to work and not
  const prefix = cookieName.match(/^__(Host|Secure)-/)?.[0];
  if (!secure && prefix) throw new Error(`createAuth: a ${prefix} cookie must be secure`);
  const cookieAttributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  const origins = (options.origins ?? []).map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      throw new Error(`createAuth: ${o} isn't an origin such as https://app.example.com`);
    }
  });

  const providers = new Map<string, SignInProvider>();
  /** Each provider by the path of its redirectUri. */
  const callbacks = new Map<string, SignInProvider>();
  for (const provider of options.providers ?? []) {
    if (!secrets.length) throw new Error("createAuth: providers need jwt.secret: a sign-in through one ends in signIn");
    const { name } = provider;
    if (typeof name !== "string" || !PROVIDER_NAME.test(name) || ROUTES.includes(name)) {
      throw new Error(`createAuth: "${name}" can't name a provider: 1 to 32 lowercase letters, digits or dashes, starting with a letter, and not me or sign-out`);
    }
    if (providers.has(name)) throw new Error(`createAuth: two providers are named "${name}"`);
    let path: string;
    try {
      path = new URL(provider.redirectUri).pathname;
    } catch {
      throw new Error(`createAuth: provider "${name}"'s redirectUri isn't a URL`);
    }
    if (callbacks.has(path)) throw new Error(`createAuth: providers "${callbacks.get(path)!.name}" and "${name}" both come back to ${path}`);
    if (!isLocalPath(provider.failureUrl)) throw new Error(`createAuth: provider "${name}"'s failureUrl must be a path on this site, such as /sign-in`);
    providers.set(name, provider);
    callbacks.set(path, provider);
  }
  // A key of its own, from each secret, so a flow cookie can never pass for a token, nor a token for one
  const flowKeys = secrets.map((s) => new Uint8Array(hkdfSync("sha256", s, new Uint8Array(0), "haikit/auth sign-in flow", 32)));
  // each sign-in on its way has a cookie of its own, named this and an id
  const flowPrefix = secure ? "__Host-haikit_sign_in-" : "haikit_sign_in-";
  // a token under such a name would be taken for a sign-in's, and cleared to make room for one
  if (providers.size && cookieName.startsWith(flowPrefix)) {
    throw new Error(`createAuth: cookie.name can't start with ${flowPrefix}: sign-ins through a provider keep their cookies under those names`);
  }

  // ── tokens ─────────────────────────────────────────────────────────

  /** The token's claims if its signature, algorithm, times, issuer and audience check out; `ours` if signIn issued it. */
  async function check(token: string): Promise<{ payload: JWTPayload; ours: boolean } | null> {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return null;
    }
    if (alg !== undefined && hmac.includes(alg)) {
      for (const secret of secrets) {
        try {
          return { payload: (await jwtVerify(token, secret, { ...checks, algorithms: hmac })).payload, ours: true };
        } catch (err) {
          // only a signature that doesn't match is worth trying the next secret for
          if (!(err instanceof errors.JWSSignatureVerificationFailed)) return null;
        }
      }
      return null;
    }
    if (alg !== undefined && keys && asymmetric.includes(alg)) {
      try {
        return { payload: (await jwtVerify(token, keys, { ...checks, algorithms: asymmetric })).payload, ours: false };
      } catch (err) {
        // Anything that isn't the token's own fault is the provider's keys
        // that couldn't be had: every sign-in fails until they can, so it's
        // worth a line in the log.
        if (!TOKEN_FAULTS.some((fault) => err instanceof fault)) console.error("[haikit] auth: the JWKS couldn't be read:", err);
        return null;
      }
    }
    return null;
  }

  const notBefores = new Map<string, { at: number | null; read: number }>();
  async function notBeforeOf(userId: string): Promise<number | null> {
    const kept = notBefores.get(userId);
    if (kept && Date.now() - kept.read < NOT_BEFORE_CACHE_MS) return kept.at;
    // as old as when it was asked for, not answered: a slow read can't stretch the window
    const asked = Date.now();
    const read = await store.getNotBefore(userId);
    // A revoke here while that read was out has kept a later time than it may
    // have found: the later one stands.
    const at = later(read, notBefores.get(userId)?.at ?? null);
    keep(notBefores, userId, { at, read: asked });
    return at;
  }

  /**
   * The user a valid token names, unless they signed in before their
   * revocation: by the second, so a sign-in in the second `revoke` ran in
   * still counts, and one straight after it is never refused. A token signIn
   * issued says when that was in `auth_time`, which a renewal keeps, so a
   * renewal can't outlive a revocation; a provider's says it by its `iat`.
   */
  async function identify(token: string) {
    const checked = await check(token);
    if (!checked) return null;
    const { payload } = checked;
    const id = payload[userClaim];
    if (typeof id !== "string" || id === "") return null;
    const notBefore = await notBeforeOf(id);
    const signedIn = checked.ours ? payload.auth_time : payload.iat;
    if (notBefore !== null && (typeof signedIn !== "number" || signedIn < Math.floor(notBefore / 1000))) return null;
    return { id, payload, ours: checked.ours };
  }

  /** The request's token: a Bearer header first, else the cookie. */
  function tokenOf(headers: Headers): { token: string; from: "bearer" | "cookie" } | null {
    const bearer = first(headers.authorization)?.match(/^Bearer +(\S+)\s*$/i);
    if (bearer) return { token: bearer[1], from: "bearer" };
    const token = cookieOf(headers, cookieName);
    return token ? { token, from: "cookie" } : null;
  }

  /** A token for `userId`, saying they signed in at `signedIn` (epoch s): now, unless it renews one. */
  async function issue(userId: string, claims: Record<string, unknown>, signedIn?: number): Promise<string> {
    if (!secrets.length) throw new Error("signIn needs jwt.secret: an identity provider's tokens are issued by the provider");
    if (typeof userId !== "string" || userId === "") throw new TypeError("signIn: userId must be a non-empty string");
    for (const name of Object.keys(claims)) {
      if (REGISTERED.includes(name) || name === userClaim) throw new TypeError(`signIn: "${name}" is set by signIn, not by claims`);
    }
    const now = Math.floor(Date.now() / 1000);
    let token = new SignJWT({ ...claims, auth_time: signedIn ?? now, ...(userClaim === "sub" ? {} : { [userClaim]: userId }) })
      .setProtectedHeader({ alg: hmac[0], typ: "JWT" })
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + Math.floor(ttlMs / 1000))
      .setJti(randomUUID());
    if (jwt.issuer !== undefined) token = token.setIssuer(jwt.issuer);
    if (jwt.audience !== undefined) token = token.setAudience(jwt.audience);
    return token.sign(secrets[0]);
  }

  /** Issue a token and set it as the cookie. */
  async function setToken(res: ServerResponse, userId: string, claims: Record<string, unknown>, signedIn?: number) {
    const token = await issue(userId, claims, signedIn);
    addCookie(res, `${cookieName}=${token}; Max-Age=${Math.floor(ttlMs / 1000)}; ${cookieAttributes}`);
    return token;
  }

  const signIn = (res: ServerResponse, userId: string, claims: Record<string, unknown> = {}) => setToken(res, userId, claims);

  function signOut(res: ServerResponse) {
    addCookie(res, `${cookieName}=; Max-Age=0; ${cookieAttributes}`);
  }

  async function verify(token: string): Promise<AuthUser | null> {
    const found = await identify(token);
    return found && { id: found.id, claims: { ...found.payload } };
  }

  async function user(req: IncomingMessage): Promise<AuthUser | null> {
    const found = tokenOf(req.headers);
    return found && verify(found.token);
  }

  // ── requests ───────────────────────────────────────────────────────

  /**
   * Whether a request came from a page of this site. A browser always sends
   * `Origin` on a POST from a page, and a page can't forge it, nor `Host`.
   * `x-forwarded-host` isn't trusted: a page's script can set it, where the
   * app's CORS lets it. Behind a proxy that rewrites `Host`, the public
   * origin goes in `origins`. A client that isn't a browser sends no
   * `Origin`, and passes.
   */
  function fromThisSite(headers: Headers): boolean {
    const origin = first(headers.origin);
    if (origin === undefined) {
      const site = first(headers["sec-fetch-site"]);
      return site === undefined || site === "same-origin" || site === "none";
    }
    if (origins.includes(origin)) return true;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false; // "null", from a sandboxed frame or a file
    }
    return host === first(headers.host);
  }

  const isJson = (headers: Headers) => first(headers["content-type"])?.split(";")[0].trim().toLowerCase() === "application/json";

  const gate: Gate = {
    async admit({ method, headers }) {
      const found = tokenOf(headers);
      if (!found) return { ok: false, status: 401, error: SIGNED_OUT };
      const who = await identify(found.token);
      if (!who) return { ok: false, status: 401, error: INVALID };
      // A cross-site form can't send JSON without a preflight, which nothing
      // here answers; and one sent with the cookie must come from this site.
      // A Bearer token is never sent by the browser on its own, so it can't
      // be forged that way, and may come from anywhere CORS lets it.
      if (method === "POST") {
        if (!isJson(headers)) return { ok: false, status: 415, error: NOT_JSON };
        if (found.from === "cookie" && !fromThisSite(headers)) return { ok: false, status: 403, error: CROSS_SITE };
      }
      // until the token stops being accepted: its exp, give or take the clock tolerance
      return { ok: true, principal: who.id, ...(typeof who.payload.exp === "number" ? { until: who.payload.exp * 1000 + clockToleranceMs } : {}) };
    },
    async allows(principal, conversationId) {
      return (await ownerOf(conversationId)) === principal;
    },
    async created(principal, conversationId) {
      await claim(conversationId, principal);
    },
  };

  // ── ownership ──────────────────────────────────────────────────────

  // Owners never change, so one known is kept; one not known yet is always
  // asked for, since another server may have just made the conversation.
  const owners = new Map<string, string>();
  async function ownerOf(conversationId: string): Promise<string | null> {
    const kept = owners.get(conversationId);
    if (kept !== undefined) return kept;
    const owner = await store.getOwner(conversationId);
    if (owner !== null) keep(owners, conversationId, owner);
    return owner;
  }

  async function claim(conversationId: string, userId: string) {
    if (typeof conversationId !== "string" || conversationId === "") throw new TypeError("claim: conversationId must be a non-empty string");
    if (typeof userId !== "string" || userId === "") throw new TypeError("claim: userId must be a non-empty string");
    await store.setOwner(conversationId, userId);
    keep(owners, conversationId, userId);
  }

  async function revoke(userId: string) {
    const at = Date.now();
    await store.setNotBefore(userId, at);
    // Known here at once, and kept, so a read already out can't put the time
    // before it back; every other server reads it within NOT_BEFORE_CACHE_MS.
    keep(notBefores, userId, { at: later(at, notBefores.get(userId)?.at ?? null), read: Date.now() });
  }

  // ── routes ─────────────────────────────────────────────────────────

  /** Who is signed in; and a cookie past half its life is issued again, so a page in use stays signed in. */
  async function me(req: IncomingMessage, res: ServerResponse) {
    const found = tokenOf(req.headers);
    const who = found && (await identify(found.token));
    if (!who) return send(res, 200, { user: null });
    const { iat, exp, auth_time } = who.payload;
    if (found.from === "cookie" && who.ours && typeof iat === "number" && typeof exp === "number" && Date.now() / 1000 > (iat + exp) / 2) {
      const claims: Record<string, unknown> = { ...who.payload };
      for (const name of [...REGISTERED, userClaim]) delete claims[name];
      // the same sign-in, renewed: a revocation after it still refuses this one
      await setToken(res, who.id, claims, typeof auth_time === "number" ? auth_time : iat);
    }
    send(res, 200, { user: { id: who.id, claims: { ...who.payload } } });
  }

  // ── sign-in through a provider ─────────────────────────────────────

  /** What the browser carries to the provider and back: which one, what its finish needs, and where to go after. */
  type Flow = { p: string; f: Record<string, string>; r: string };

  /** `GET {basePath}/{name}`: off to the provider, with the flow in a cookie of its own. */
  async function startSignIn(provider: SignInProvider, url: URL, req: IncomingMessage, res: ServerResponse) {
    const returnTo = url.searchParams.get("return_to");
    let started: Awaited<ReturnType<SignInProvider["start"]>>;
    try {
      started = await provider.start();
    } catch (err) {
      console.error(`[haikit] auth: a sign-in with ${provider.name} couldn't start:`, err);
      return failed(res, provider, "failed");
    }
    // encoded first, so the limit is on what the Location will carry
    const wanted = isLocalPath(returnTo) ? forLocation(returnTo) : "/";
    const flow: Flow = { p: provider.name, f: started.flow, r: isLocalPath(wanted) ? wanted : "/" };
    // so a sign-in in another tab, and its way back, never touch this one's
    const name = flowPrefix + randomBytes(6).toString("base64url");
    let sealed = await seal(flow);
    // A browser drops a cookie past its size, and the way back would find
    // none: rather lose return_to than the sign-in.
    if (bytes(name, sealed) > COOKIE_BYTES && flow.r !== "/") sealed = await seal({ ...flow, r: "/" });
    if (bytes(name, sealed) > COOKIE_BYTES) {
      console.error(`[haikit] auth: a sign-in with ${provider.name} couldn't start: its flow is too large for a cookie`);
      return failed(res, provider, "failed");
    }
    // The others on their way keep theirs while they all fit in one cookie's
    // room. Past that, the earliest started go: browsers send cookies of one
    // path in the order they were set (RFC 6265, 5.4).
    let room = COOKIE_BYTES - bytes(name, sealed);
    for (const [other, value] of flowCookies(req.headers).reverse()) {
      room -= bytes(other, value);
      if (room < 0) addCookie(res, `${other}=; Max-Age=0; ${cookieAttributes}`);
    }
    addCookie(res, `${name}=${sealed}; Max-Age=${SIGN_IN_FLOW_MS / 1000}; ${cookieAttributes}`);
    redirect(res, started.url.href);
  }

  const seal = (flow: Flow) =>
    new EncryptJWT(flow)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime(Math.floor((Date.now() + SIGN_IN_FLOW_MS) / 1000))
      .encrypt(flowKeys[0]);
  const bytes = (name: string, value: string) => Buffer.byteLength(`${name}=${value}`);
  /** The browser's flow cookies, name and value, as it sent them: the earliest started first. */
  const flowCookies = (headers: Headers) => cookiesOf(headers).filter(([name]) => name.startsWith(flowPrefix));

  /** The flow a cookie carries, if one of the secrets sealed it and it hasn't expired. */
  async function openFlow(sealed: string): Promise<Flow | null> {
    for (const key of flowKeys) {
      try {
        const { payload } = await jwtDecrypt(sealed, key, { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"], requiredClaims: ["exp"] });
        const { p, f, r } = payload as Partial<Flow>;
        const fields = typeof f === "object" && f !== null ? Object.values(f) : null;
        if (typeof p !== "string" || !isLocalPath(r) || !fields?.every((v) => typeof v === "string")) return null;
        return { p, f: f!, r };
      } catch (err) {
        // only a cookie sealed with another secret is worth trying the next one for
        if (!(err instanceof errors.JWEDecryptionFailed)) return null;
      }
    }
    return null;
  }

  /** The browser back from the provider: whoever it names is signed in, or the failure page says why not. */
  async function finishSignIn(provider: SignInProvider, url: URL, req: IncomingMessage, res: ServerResponse) {
    // This answers one of the sign-ins on their way: the one whose finish
    // takes it, the newest tried first. Only its cookie is cleared, so a
    // sign-in another tab starts meanwhile still finishes.
    for (const [name, sealed] of flowCookies(req.headers).reverse()) {
      const flow = await openFlow(sealed);
      // past its time, altered, or another provider's: left to its Max-Age
      if (!flow || flow.p !== provider.name) continue;
      const clear = () => addCookie(res, `${name}=; Max-Age=0; ${cookieAttributes}`);
      let outcome: Awaited<ReturnType<SignInProvider["finish"]>>;
      try {
        outcome = await provider.finish(url, flow.f);
      } catch (err) {
        clear();
        console.error(`[haikit] auth: a sign-in with ${provider.name} failed:`, err);
        return failed(res, provider, "failed");
      }
      // the answer to another of them
      if ("error" in outcome && outcome.error === "expired") continue;
      // one way or another this sign-in is over, and its flow with it
      clear();
      if ("error" in outcome) return failed(res, provider, outcome.error === "access_denied" ? "access_denied" : "refused");
      try {
        await signIn(res, outcome.userId, outcome.claims ?? {});
      } catch (err) {
        console.error(`[haikit] auth: a sign-in with ${provider.name} failed:`, err);
        return failed(res, provider, "failed");
      }
      return redirect(res, flow.r);
    }
    failed(res, provider, "expired");
  }

  function failed(res: ServerResponse, provider: SignInProvider, why: "access_denied" | "refused" | "expired" | "failed") {
    const to = new URL(provider.failureUrl, "http://localhost");
    to.searchParams.set("sign_in_error", why);
    // The path as configured, not as URL normalizes it: /a/..//b would become
    // //b, which a browser reads as another host.
    redirect(res, forLocation(provider.failureUrl.split(/[?#]/)[0]) + to.search + to.hash);
  }

  function handler(basePath = "/auth") {
    // a provider's way back on a route this handler answers would take it over
    const answered = [...ROUTES, ...providers.keys()].map((route) => `${basePath}/${route}`);
    for (const [path, provider] of callbacks) {
      if (answered.includes(path)) throw new Error(`auth.handler: provider "${provider.name}"'s redirectUri comes back to ${path}, a route the handler answers already`);
    }
    return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        return false;
      }
      const callback = callbacks.get(url.pathname);
      const starting = url.pathname.startsWith(`${basePath}/`) ? providers.get(url.pathname.slice(basePath.length + 1)) : undefined;
      if ((callback || starting) && req.method === "GET") {
        try {
          if (callback) await finishSignIn(callback, url, req, res);
          else await startSignIn(starting!, url, req, res);
        } catch (err) {
          console.error("[haikit] auth request failed:", err);
          if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }
      const route = url.pathname === `${basePath}/me` ? "me" : url.pathname === `${basePath}/sign-out` ? "sign-out" : null;
      if (route === "me" && req.method === "GET") {
        try {
          await me(req, res);
        } catch (err) {
          // as nodeHandler does: answered and logged, never thrown on to the server
          console.error("[haikit] auth request failed:", err);
          if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }
      if (route === "sign-out" && req.method === "POST") {
        if (!fromThisSite(req.headers)) send(res, 403, { error: CROSS_SITE });
        else {
          signOut(res);
          res.writeHead(204, { "cache-control": "no-store" }).end();
        }
        return true;
      }
      return false;
    };
  }

  return { gate, handler, signIn, signOut, verify, user, ownerOf, claim, revoke };
}

/** Add a `Set-Cookie`, keeping any the response already has. */
function addCookie(res: ServerResponse, cookie: string) {
  const had = res.getHeader("set-cookie");
  const list = had === undefined ? [] : Array.isArray(had) ? had : [String(had)];
  res.setHeader("set-cookie", [...list, cookie]);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { location, "cache-control": "no-store" }).end();
}

/** Every cookie a request carries, name and value, in the order it sent them. */
function cookiesOf(headers: Headers): [string, string][] {
  const found: [string, string][] = [];
  for (const part of (first(headers.cookie) ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) found.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
  }
  return found;
}

/** A cookie's value, from the first of that name; null if there's none. */
function cookieOf(headers: Headers, name: string): string | null {
  return cookiesOf(headers).find(([n]) => n === name)?.[1] ?? null;
}

/** The later of two times, either of which may be missing. */
const later = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** Keep `value` as the newest entry, letting the oldest go past CACHE_ENTRIES. */
function keep<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_ENTRIES) map.delete(map.keys().next().value!);
}
