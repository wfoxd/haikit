/**
 * What `oidc()` and `oauth2()` share: how their options are checked, how
 * long a request to the provider may take, and whom a provider's user signs
 * in as by default. Not one of the package's exports.
 */

import * as oauth from "oauth4webapi";

/** Who signed in, as a provider says: `OidcProfile` and `OAuth2Profile` are this. */
export interface Profile {
  provider: string;
  sub: string;
  claims: Record<string, unknown>;
}

/**
 * Whom a provider's user signs in as. A string: that user id, with the
 * default claims. An object: that user id, and exactly those claims.
 */
export type SignInAs = string | { userId: string; claims?: Record<string, unknown> };

export type TokenEndpointAuthMethod = "client_secret_basic" | "client_secret_post";

/** How long a request to the provider may take: its settings, the code's exchange, or its API. */
export const REQUEST_TIMEOUT_MS = 10_000;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const AUTH_METHODS = ["client_secret_basic", "client_secret_post"];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** `<kind>: name must be …`, for a name that can't be a route segment. */
export function checkName(kind: string, name: unknown): void {
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`${kind}: name must be 1 to 32 lowercase letters, digits or dashes, starting with a letter`);
}

export function checkClient(kind: string, clientId: unknown, clientSecret: unknown): void {
  if (typeof clientId !== "string" || clientId === "") throw new Error(`${kind}: clientId must be a non-empty string`);
  if (typeof clientSecret !== "string" || clientSecret === "") throw new Error(`${kind}: clientSecret must be a non-empty string`);
}

/** https, or http on loopback, and no fragment: never worked out from a request, whose `Host` can say anything. */
export function checkRedirectUri(kind: string, redirectUri: string, example: string): void {
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error(`${kind}: redirectUri must be a URL, such as ${example}`);
  }
  if (!(redirect.protocol === "https:" || (redirect.protocol === "http:" && LOOPBACK.includes(redirect.hostname))) || redirect.hash) {
    throw new Error(`${kind}: redirectUri must be https, or http on localhost, with no #fragment`);
  }
}

/** `params` can't set what the flow sets itself. */
export function checkParams(kind: string, params: Record<string, string> | undefined, flowParams: string[]): void {
  for (const param of Object.keys(params ?? {})) {
    if (flowParams.includes(param)) throw new Error(`${kind}: params can't set ${param}: the sign-in sets it`);
  }
}

export function checkAuthMethod(kind: string, method: unknown): void {
  if (method !== undefined && !AUTH_METHODS.includes(method as string)) throw new Error(`${kind}: tokenEndpointAuthMethod must be client_secret_basic or client_secret_post`);
}

/** oauth4webapi's request options: the timeout, and the app's own fetch if it has one. */
export function requestOptions(custom: typeof globalThis.fetch | undefined) {
  return {
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(custom ? { [oauth.customFetch]: (url: string, init: oauth.CustomFetchOptions<string, unknown>) => custom(url, init as RequestInit) } : {}),
  };
}

export function clientAuth(method: TokenEndpointAuthMethod, clientSecret: string): oauth.ClientAuth {
  return method === "client_secret_post" ? oauth.ClientSecretPost(clientSecret) : oauth.ClientSecretBasic(clientSecret);
}

/** What `user` answered, as `finish` returns it: a string gets the default claims, and null is refused. */
export async function signInAs(
  user: (profile: Profile) => SignInAs | null | Promise<SignInAs | null>,
  profile: Profile,
): Promise<{ userId: string; claims?: Record<string, unknown> } | { error: "refused" }> {
  const chosen = await user(profile);
  if (chosen === null) return { error: "refused" };
  return typeof chosen === "string" ? { userId: chosen, claims: defaultClaims(profile) } : chosen;
}

export function defaultUser(profile: Profile): SignInAs {
  return { userId: `${profile.provider}:${profile.sub}`, claims: defaultClaims(profile) };
}

/** The user's `name`, and their `email` only once the provider has verified it: anyone can type an address. */
function defaultClaims({ claims }: Profile): Record<string, unknown> {
  const { name, email, email_verified } = claims;
  return { ...(typeof name === "string" ? { name } : {}), ...(typeof email === "string" && email_verified === true ? { email } : {}) };
}
