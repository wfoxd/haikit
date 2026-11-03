/**
 * @haikit/auth/oauth2 — sign in with GitHub, or any OAuth 2.0 provider.
 *
 * The authorization code flow, with PKCE and state, on oauth4webapi, for a
 * provider that doesn't speak OpenID Connect: there's no ID token to say who
 * signed in, so the code is exchanged for an access token, `profile` reads
 * the user from the provider's API with it, and the token is dropped. The
 * rest is as `oidc()`: pass what `github()` or `oauth2()` returns to
 * createAuth's `providers`, link to `{basePath}/{name}`, and a user who signs
 * in there gets the same token cookie as one the app's own login signs in.
 */

import * as oauth from "oauth4webapi";
import type { SignInProvider } from "./index.js";
import {
  REQUEST_TIMEOUT_MS,
  checkAuthMethod,
  checkClient,
  checkName,
  checkParams,
  checkRedirectUri,
  clientAuth,
  defaultUser,
  requestOptions,
  signInAs,
  type SignInAs,
} from "./provider.js";

export type { SignInAs } from "./provider.js";

/** Who signed in, as `profile` read it from the provider's API. */
export interface OAuth2Profile {
  /** The provider's `name`, such as `"github"`. */
  provider: string;
  /** The provider's id for the user, which it never reuses. */
  sub: string;
  claims: Record<string, unknown>;
}

/** The provider's API, with the access token the sign-in was given. */
export interface ProviderApi {
  /**
   * GET an https URL with the access token as a Bearer token, and resolve to
   * the JSON it answers with. A status other than 2xx, a redirect included,
   * throws an `Error` with that `status`. Gives up after 10 s.
   */
  get(url: string, headers?: Record<string, string>): Promise<unknown>;
}

export interface OAuth2Options {
  /** The route segment, `{basePath}/{name}`, and the default user id's prefix. */
  name: string;
  /** Where the user signs in, such as `https://github.com/login/oauth/authorize`. https. */
  authorizationEndpoint: string;
  /** Where the code is exchanged for an access token, such as `https://github.com/login/oauth/access_token`. https. */
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /**
   * Where the provider sends the browser back, exactly as registered with
   * it, such as `https://app.example.com/auth/github/callback`. https, or
   * http on localhost. Never taken from the request: a `Host` header can say
   * anything.
   */
  redirectUri: string;
  /** What to ask for. Default none, and no `scope` is sent. */
  scopes?: string[];
  /** More parameters for the provider's sign-in page, such as `{ prompt: "consent" }`. */
  params?: Record<string, string>;
  /** How the client proves itself when it exchanges the code, as registered with the provider. Default `"client_secret_basic"`. */
  tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post";
  /**
   * Who signed in: read from the provider's API, such as its `/user`, with
   * `api.get`. `sub` is the provider's id for the user, which it never
   * reuses, as a string. The claims are what `user` sees; put an `email`
   * there with `email_verified: true` only once the provider has verified it.
   */
  profile(api: ProviderApi): Promise<{ sub: string; claims?: Record<string, unknown> }>;
  /**
   * Whom the user signs in as, or null to refuse them. Default: the user id
   * `{name}:{sub}`, with their `name`, and their `email` if verified.
   */
  user?(profile: OAuth2Profile): SignInAs | null | Promise<SignInAs | null>;
  /** A path on this site that a failed sign-in is sent to, with `?sign_in_error=`. Default `"/"`. */
  failureUrl?: string;
  /** Used to exchange the code and for `api.get`, in place of the global fetch: for a proxy, or a test's stand-in provider. */
  fetch?: typeof globalThis.fetch;
}

export interface GitHubOptions extends Omit<OAuth2Options, "name" | "authorizationEndpoint" | "tokenEndpoint" | "profile"> {
  /** Default `["read:user", "user:email"]`: the profile, and the email addresses, to find the verified primary one. */
  scopes?: string[];
  /** Default `"client_secret_post"`, as GitHub's guide sends the client. */
  tokenEndpointAuthMethod?: OAuth2Options["tokenEndpointAuthMethod"];
}

/** The parameters the flow sets itself. */
const FLOW_PARAMS = ["client_id", "redirect_uri", "response_type", "response_mode", "scope", "state", "code_challenge", "code_challenge_method"];
const GITHUB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

/** Sign in with an OAuth 2.0 provider. */
export function oauth2(options: OAuth2Options): SignInProvider {
  const { name, clientId, clientSecret, redirectUri, tokenEndpointAuthMethod = "client_secret_basic", profile } = options;
  checkName("oauth2", name);
  const authorization = endpoint("authorizationEndpoint", options.authorizationEndpoint, `${GITHUB}/login/oauth/authorize`);
  const token = endpoint("tokenEndpoint", options.tokenEndpoint, `${GITHUB}/login/oauth/access_token`);
  checkClient("oauth2", clientId, clientSecret);
  checkRedirectUri("oauth2", redirectUri, "https://app.example.com/auth/github/callback");
  checkParams("oauth2", options.params, FLOW_PARAMS);
  checkAuthMethod("oauth2", tokenEndpointAuthMethod);
  if (typeof profile !== "function") throw new Error("oauth2: profile must be a function: with no ID token, it's what says who signed in");
  const scope = [...new Set(options.scopes ?? [])].join(" ");
  const user = options.user ?? defaultUser;
  const client: oauth.Client = { client_id: clientId };
  const http = requestOptions(options.fetch);
  // No settings to read: the endpoints are the provider's settings. oauth4webapi wants an issuer, and checks only an ID token's against it.
  const as: oauth.AuthorizationServer = { issuer: authorization.origin, authorization_endpoint: authorization.href, token_endpoint: token.href };

  return {
    name,
    redirectUri,
    failureUrl: options.failureUrl ?? "/",

    async start() {
      const state = oauth.generateRandomState();
      const verifier = oauth.generateRandomCodeVerifier();
      const url = new URL(authorization);
      for (const [param, value] of Object.entries({
        ...options.params,
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        ...(scope ? { scope } : {}),
        state,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      })) {
        url.searchParams.set(param, value);
      }
      return { url, flow: { state, verifier } };
    },

    async finish(callback, flow) {
      // the answer to another sign-in, started since in this browser: not an attack worth a log line
      if (callback.searchParams.get("state") !== flow.state) return { error: "expired" };
      // An iss (RFC 9207) would be checked against an issuer this provider
      // doesn't have. Against mix-up, each provider comes back to a path of
      // its own, and takes only its own flow there (RFC 9700, 4.4.2).
      const answer = new URLSearchParams(callback.searchParams);
      answer.delete("iss");
      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(as, client, answer, flow.state);
      } catch (err) {
        if (err instanceof oauth.AuthorizationResponseError && err.error === "access_denied") return { error: "access_denied" };
        throw err;
      }
      const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth(tokenEndpointAuthMethod, clientSecret), params, redirectUri, flow.verifier, http);
      const { access_token } = await oauth.processAuthorizationCodeResponse(as, client, response);
      const found = await profile(providerApi(access_token, options.fetch));
      if (typeof found?.sub !== "string" || found.sub === "" || (found.claims !== undefined && (typeof found.claims !== "object" || found.claims === null))) {
        throw new Error("oauth2: profile must return { sub, claims? }: sub a non-empty string, such as String(user.id), and claims an object");
      }
      // the token goes no further: signing in is all it was asked for
      return signInAs(user, { provider: name, sub: found.sub, claims: { ...found.claims } });
    },
  };
}

/** Sign in with GitHub. */
export function github(options: GitHubOptions): SignInProvider {
  // GitHub's guide sends the client in the body, and so does this
  const { scopes = ["read:user", "user:email"], tokenEndpointAuthMethod = "client_secret_post", ...rest } = options;
  return oauth2({
    ...rest,
    name: "github",
    authorizationEndpoint: `${GITHUB}/login/oauth/authorize`,
    tokenEndpoint: `${GITHUB}/login/oauth/access_token`,
    scopes,
    tokenEndpointAuthMethod,
    profile: githubProfile,
  });
}

/**
 * A GitHub user: `sub` is their numeric id, which stays when their login
 * changes. The claims are what `/user` says, but its `email`, the public one:
 * `email` is the primary address, once verified, from `/user/emails`.
 */
async function githubProfile(api: ProviderApi) {
  const user = (await api.get(`${GITHUB_API}/user`, GITHUB_HEADERS)) as Record<string, unknown> | null;
  if (typeof user?.id !== "number") throw new Error("github: GitHub's /user answered with no id");
  let email: string | undefined;
  try {
    const emails = await api.get(`${GITHUB_API}/user/emails`, GITHUB_HEADERS);
    const primary = Array.isArray(emails) ? emails.find((e) => e?.primary === true && e.verified === true && typeof e.email === "string") : undefined;
    email = primary?.email;
  } catch (err) {
    // 404 without user:email, 403 for a GitHub App without the email permission: signed in without one
    const status = (err as { status?: unknown }).status;
    if (status !== 403 && status !== 404) throw err;
  }
  const { email: _public, ...claims } = user;
  // name is optional on GitHub, and often empty: the login is what they go by there
  const name = typeof user.name === "string" && user.name !== "" ? user.name : user.login;
  return { sub: String(user.id), claims: { ...claims, name, ...(email ? { email, email_verified: true } : {}) } };
}

/** An https endpoint, from an option of that name. */
function endpoint(option: string, value: string, example: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`oauth2: ${option} must be a URL, such as ${example}`);
  }
  // the user types their password at one, and the client sends its secret to the other
  if (url.protocol !== "https:") throw new Error(`oauth2: ${option} must be an https URL`);
  return url;
}

function providerApi(accessToken: string, custom: typeof globalThis.fetch | undefined): ProviderApi {
  return {
    async get(url, headers) {
      let at: URL | null = null;
      try {
        at = new URL(url);
      } catch {}
      // the access token goes with it: never in the clear
      if (at?.protocol !== "https:") throw new Error("oauth2: api.get takes an https URL: the access token goes with it");
      const sent = new Headers(headers);
      if (!sent.has("accept")) sent.set("accept", "application/json");
      sent.set("authorization", `Bearer ${accessToken}`);
      // a redirect is answered, not followed: the token stays where it was sent
      const response = await (custom ?? fetch)(at.href, { headers: sent, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`oauth2: GET ${at.href} answered ${response.status}`), { status: response.status });
      }
      return response.json();
    },
  };
}
