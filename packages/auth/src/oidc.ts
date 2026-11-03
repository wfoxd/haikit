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
import { checkAuthMethod, checkClient, checkName, checkParams, checkRedirectUri, clientAuth, defaultUser, requestOptions, signInAs, type SignInAs } from "./provider.js";

export type { SignInAs } from "./provider.js";

/** Who signed in, as the provider says: its ID token's claims, checked. */
export interface OidcProfile {
  /** The provider's `name`, such as `"google"`. */
  provider: string;
  /** The provider's id for the user: never reused, and kept when their email changes. */
  sub: string;
  claims: Record<string, unknown>;
}

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
   * How the client proves itself when it exchanges the code, as registered
   * with the provider. Default `"client_secret_basic"`, unless the provider's
   * settings list `"client_secret_post"` and not it.
   */
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
  /**
   * How long ago the user may have last signed in at the provider. Sent as
   * `max_age`, in whole seconds, and an ID token whose `auth_time` is older,
   * or missing, is refused. Default: no limit.
   */
  maxAgeMs?: number;
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
  /** Default `"client_secret_post"`: Google's token endpoint doesn't decode the Basic header RFC 6749 describes. */
  tokenEndpointAuthMethod?: OidcOptions["tokenEndpointAuthMethod"];
}

const GOOGLE = "https://accounts.google.com";
/** The parameters the flow sets itself. */
const FLOW_PARAMS = ["client_id", "redirect_uri", "response_type", "response_mode", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "max_age"];

/** Sign in with an OpenID Connect provider. */
export function oidc(options: OidcOptions): SignInProvider {
  const { name, clientId, clientSecret, redirectUri, tokenEndpointAuthMethod, maxAgeMs } = options;
  checkName("oidc", name);
  let issuer: URL;
  try {
    issuer = new URL(options.issuer);
  } catch {
    throw new Error("oidc: issuer must be a URL, such as https://accounts.google.com");
  }
  if (issuer.protocol !== "https:") throw new Error("oidc: issuer must be an https URL");
  checkClient("oidc", clientId, clientSecret);
  checkRedirectUri("oidc", redirectUri, "https://app.example.com/auth/google/callback");
  checkParams("oidc", options.params, FLOW_PARAMS);
  checkAuthMethod("oidc", tokenEndpointAuthMethod);
  if (maxAgeMs !== undefined && !(Number.isFinite(maxAgeMs) && maxAgeMs >= 0)) throw new Error("oidc: maxAgeMs must be a finite number, at least 0");
  // max_age is in whole seconds; it's sent, and checked against auth_time, as that
  const maxAge = maxAgeMs === undefined ? undefined : Math.floor(maxAgeMs / 1000);
  const scope = [...new Set(["openid", ...(options.scopes ?? ["openid", "email", "profile"])])].join(" ");
  const user = options.user ?? defaultUser;
  const client: oauth.Client = { client_id: clientId };
  const http = requestOptions(options.fetch);

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
      // where the user types their password: never over plain http, whatever the settings say
      if (new URL(as.authorization_endpoint).protocol !== "https:") throw new Error(`oidc: ${issuer.href}'s authorization_endpoint isn't https`);
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
        ...(maxAge === undefined ? {} : { max_age: String(maxAge) }),
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
      // as registered; else client_secret_basic, what a provider that names none takes
      const methods = as.token_endpoint_auth_methods_supported;
      const method = tokenEndpointAuthMethod ?? (methods && !methods.includes("client_secret_basic") && methods.includes("client_secret_post") ? "client_secret_post" : "client_secret_basic");
      const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth(method, clientSecret), params, redirectUri, flow.verifier, http);
      const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
        expectedNonce: flow.nonce,
        requireIdToken: true,
        ...(maxAge === undefined ? {} : { maxAge }),
      });
      const claims = { ...oauth.getValidatedIdTokenClaims(result)! };
      return signInAs(user, { provider: name, sub: claims.sub, claims });
    },
  };
}

/** Sign in with Google. */
export function google(options: GoogleOptions): SignInProvider {
  // In a Basic header, the id and secret are form-encoded (RFC 6749, 2.3.1),
  // and a Google client id is all dots and dashes: Google doesn't decode them,
  // and answers invalid_client. In the body, as Google's own guide sends them.
  const { hostedDomain, prompt = "select_account", user = defaultUser, params, tokenEndpointAuthMethod = "client_secret_post", ...rest } = options;
  if (hostedDomain !== undefined && (typeof hostedDomain !== "string" || hostedDomain === "")) {
    throw new Error("google: hostedDomain must be a domain, such as example.com");
  }
  // Each has an option of its own, which is what's sent: in params, prompt
  // would be overridden, and hd would be a hint to the page that nothing checks.
  for (const [param, option] of [["prompt", "the prompt option"], ["hd", "hostedDomain, which also checks the account's domain"]]) {
    if (Object.keys(params ?? {}).includes(param)) throw new Error(`google: params can't set ${param}: use ${option}`);
  }
  return oidc({
    ...rest,
    name: "google",
    issuer: GOOGLE,
    tokenEndpointAuthMethod,
    params: { ...params, ...(prompt ? { prompt } : {}), ...(hostedDomain ? { hd: hostedDomain } : {}) },
    // hd on the sign-in page only picks which accounts are offered first: the ID token says which one signed in
    user: (profile) => (hostedDomain !== undefined && profile.claims.hd !== hostedDomain ? null : user(profile)),
  });
}
