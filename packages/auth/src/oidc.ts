/**
 * @haikit/auth/oidc — sign in with Google, or any OpenID Connect provider.
 *
 * The authorization code flow, with PKCE, state and nonce, on oauth4webapi:
 * pass what `google()` or `oidc()` returns to createAuth's `providers`, link
 * to `{basePath}/{name}`, and a user who signs in there gets the same token
 * cookie as one the app's own login signs in. The ID token comes straight
 * from the provider's token endpoint over https, so its claims are checked
 * (issuer, audience, expiry, nonce) and its signature, as OpenID Connect
 * allows there, isn't.
 */

import * as oauth from "oauth4webapi";
import type { SignInProvider } from "./index.js";

/** Who signed in, as the provider says: its ID token's claims, checked. */
export interface OidcProfile {
  /** The provider's `name`, such as `"google"`. */
  provider: string;
  /** The provider's id for the user: never reused, and kept when their email changes. */
  sub: string;
  claims: Record<string, unknown>;
}

/**
 * Whom a provider's user signs in as. A string: that user id, with the
 * default claims. An object: that user id, and exactly those claims.
 */
export type SignInAs = string | { userId: string; claims?: Record<string, unknown> };

export interface OidcOptions {
  /** The route segment, `{basePath}/{name}`, and the default user id's prefix. */
  name: string;
  /** The provider's issuer, an https URL. Its settings are read from `{issuer}/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Where the provider sends the browser back, exactly as registered with
   * it, such as `https://app.example.com/auth/google/callback`. https, or
   * http on localhost. Never taken from the request: a `Host` header can say
   * anything.
   */
  redirectUri: string;
  /** Default `["openid", "email", "profile"]`. `openid` is always asked for. */
  scopes?: string[];
  /** More parameters for the provider's sign-in page, such as `{ prompt: "consent" }`. */
  params?: Record<string, string>;
  /**
   * Whom the user signs in as, or null to refuse them. Default: the user id
   * `{name}:{sub}`, with their `name`, and their `email` if the provider has
   * verified it.
   */
  user?(profile: OidcProfile): SignInAs | null | Promise<SignInAs | null>;
  /** A path on this site that a failed sign-in is sent to, with `?sign_in_error=`. Default `"/"`. */
  failureUrl?: string;
  /** Used to read the provider's settings and exchange the code, in place of the global fetch: for a proxy, or a test's stand-in provider. */
  fetch?: typeof globalThis.fetch;
}

export interface GoogleOptions extends Omit<OidcOptions, "name" | "issuer"> {
  /**
   * A Google Workspace domain, such as `"example.com"`: only its accounts may
   * sign in. Google's sign-in page offers them first, and an ID token from
   * any other account is refused.
   */
  hostedDomain?: string;
  /** Google's `prompt`. Default `"select_account"`, so a user with several accounts picks one; `""` sends none. */
  prompt?: string;
}

const GOOGLE = "https://accounts.google.com";
/** How long reading the provider's settings, or exchanging the code, may take. */
const REQUEST_TIMEOUT_MS = 10_000;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** The parameters the flow sets itself. */
const FLOW_PARAMS = ["client_id", "redirect_uri", "response_type", "response_mode", "scope", "state", "nonce", "code_challenge", "code_challenge_method"];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Sign in with an OpenID Connect provider. */
export function oidc(options: OidcOptions): SignInProvider {
  const { name, clientId, clientSecret } = options;
  if (typeof name !== "string" || !NAME.test(name)) throw new Error("oidc: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter");
  let issuer: URL;
  try {
    issuer = new URL(options.issuer);
  } catch {
    throw new Error("oidc: issuer must be a URL, such as https://accounts.google.com");
  }
  if (issuer.protocol !== "https:") throw new Error("oidc: issuer must be an https URL");
  if (typeof clientId !== "string" || clientId === "") throw new Error("oidc: clientId must be a non-empty string");
  if (typeof clientSecret !== "string" || clientSecret === "") throw new Error("oidc: clientSecret must be a non-empty string");
  let redirect: URL;
  try {
    redirect = new URL(options.redirectUri);
  } catch {
    throw new Error("oidc: redirectUri must be a URL, such as https://app.example.com/auth/google/callback");
  }
  if (!(redirect.protocol === "https:" || (redirect.protocol === "http:" && LOOPBACK.includes(redirect.hostname))) || redirect.hash) {
    throw new Error("oidc: redirectUri must be https, or http on localhost, with no #fragment");
  }
  const redirectUri = options.redirectUri;
  for (const param of Object.keys(options.params ?? {})) {
    if (FLOW_PARAMS.includes(param)) throw new Error(`oidc: params can't set ${param}: the sign-in sets it`);
  }
  const scope = [...new Set(["openid", ...(options.scopes ?? ["openid", "email", "profile"])])].join(" ");
  const user = options.user ?? defaultUser;
  const client: oauth.Client = { client_id: clientId };
  const custom = options.fetch;
  const http = {
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(custom ? { [oauth.customFetch]: (url: string, init: oauth.CustomFetchOptions<string, unknown>) => custom(url, init as RequestInit) } : {}),
  };

  // Read once, on the first sign-in, and kept; one that fails is read again next time.
  let settings: Promise<oauth.AuthorizationServer> | null = null;
  const server = () =>
    (settings ??= oauth
      .discoveryRequest(issuer, { ...http, algorithm: "oidc" })
      .then((response) => oauth.processDiscoveryResponse(issuer, response))
      .catch((err) => {
        settings = null;
        throw err;
      }));

  return {
    name,
    redirectUri,
    failureUrl: options.failureUrl ?? "/",

    async start() {
      const as = await server();
      if (!as.authorization_endpoint) throw new Error(`oidc: ${issuer.href} names no authorization_endpoint`);
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const verifier = oauth.generateRandomCodeVerifier();
      const url = new URL(as.authorization_endpoint);
      for (const [param, value] of Object.entries({
        ...options.params,
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope,
        state,
        nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      })) {
        url.searchParams.set(param, value);
      }
      return { url, flow: { state, nonce, verifier } };
    },

    async finish(callback, flow) {
      // the answer to another sign-in, started since in this browser: not an attack worth a log line
      if (callback.searchParams.get("state") !== flow.state) return { error: "expired" };
      const as = await server();
      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(as, client, callback, flow.state);
      } catch (err) {
        if (err instanceof oauth.AuthorizationResponseError && err.error === "access_denied") return { error: "access_denied" };
        throw err;
      }
      // client_secret_basic is what a provider that names none takes
      const methods = as.token_endpoint_auth_methods_supported;
      const clientAuth = methods && !methods.includes("client_secret_basic") && methods.includes("client_secret_post")
        ? oauth.ClientSecretPost(clientSecret)
        : oauth.ClientSecretBasic(clientSecret);
      const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth, params, redirectUri, flow.verifier, http);
      const result = await oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: flow.nonce, requireIdToken: true });
      const claims = { ...oauth.getValidatedIdTokenClaims(result)! };
      const profile: OidcProfile = { provider: name, sub: claims.sub, claims };
      const chosen = await user(profile);
      if (chosen === null) return { error: "refused" };
      return typeof chosen === "string" ? { userId: chosen, claims: defaultClaims(profile) } : chosen;
    },
  };
}

/** Sign in with Google. */
export function google(options: GoogleOptions): SignInProvider {
  const { hostedDomain, prompt = "select_account", user = defaultUser, params, ...rest } = options;
  if (hostedDomain !== undefined && (typeof hostedDomain !== "string" || hostedDomain === "")) {
    throw new Error("google: hostedDomain must be a domain, such as example.com");
  }
  return oidc({
    ...rest,
    name: "google",
    issuer: GOOGLE,
    params: { ...params, ...(prompt ? { prompt } : {}), ...(hostedDomain ? { hd: hostedDomain } : {}) },
    // hd on the sign-in page only picks which accounts are offered first: the ID token says which one signed in
    user: (profile) => (hostedDomain !== undefined && profile.claims.hd !== hostedDomain ? null : user(profile)),
  });
}

function defaultUser(profile: OidcProfile): SignInAs {
  return { userId: `${profile.provider}:${profile.sub}`, claims: defaultClaims(profile) };
}

/** The user's `name`, and their `email` only once the provider has verified it: anyone can type an address. */
function defaultClaims({ claims }: OidcProfile): Record<string, unknown> {
  const { name, email, email_verified } = claims;
  return { ...(typeof name === "string" ? { name } : {}), ...(typeof email === "string" && email_verified === true ? { email } : {}) };
}
