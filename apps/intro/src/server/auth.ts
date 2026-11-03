import { randomBytes } from "node:crypto";
import type { Gate } from "@haikit/core";
import { type Auth, type AuthStore, createAuth, memoryAuthStore } from "@haikit/auth";
import { type OAuth2Profile, type ProviderApi, oauth2 } from "@haikit/auth/oauth2";
import { type OidcProfile, type SignInAs, google } from "@haikit/auth/oidc";
import type { Queryable } from "@haikit/auth/postgres";

// Sign in with Google or GitHub, each once the deployment has a client to
// sign in with there. It's optional for the reader: signed out, anyone reads
// the introduction, as without it. Signed in, the conversations they start
// are theirs alone, and the welcome greets them by name.
const PRODUCTION = process.env.NODE_ENV === "production";

// The token's cookie, named here because the gate looks for it: auth's
// default, `__Host-` only where it's Secure (Safari keeps no Secure cookie on
// http://localhost).
const COOKIE = PRODUCTION ? "__Host-haikit_token" : "haikit_token";

// A reader who isn't signed in. Never a user's id: those are google:<sub> and github:<id>.
const ANYONE = "anyone";

// Each signed-in reader's name, from their token, for the welcome: by user
// id, the latest 10,000.
const NAMES_KEPT = 10_000;
const names = new Map<string, string>();

let auth: Auth | null = null;

/**
 * The sign-in routes, where there's a Google or a GitHub client, the
 * providers they're for, and the gate. Without a client or a database
 * there's no gate: no conversation is anyone's alone.
 */
export async function signingIn(db: Queryable | null, port: number): Promise<{ auth: Auth | null; signIn: string[]; gate?: Gate }> {
  const googleClient = clientOf("GOOGLE");
  const githubClient = clientOf("GITHUB");
  if (!googleClient && !githubClient) {
    if (!db) return { auth: null, signIn: [] };
    // No one signs in now, but a conversation started signed in while someone
    // could is still in the database: it stays closed, until there's a client
    // again for its reader to sign in with.
    const store = await owners(db);
    return {
      auth: null,
      signIn: [],
      gate: {
        admit: async () => ({ ok: true, principal: ANYONE }),
        allows: async (_principal, conversationId) => (await store.getOwner(conversationId)) === null,
        created: async () => {},
      },
    };
  }

  // The secret tokens are signed with. Without one, a random secret for this
  // run only: every sign-in ends when the server stops.
  const secret = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
  if (!secret) throw new Error("set HAIKIT_AUTH_SECRET to sign readers in: at least 32 bytes, such as `openssl rand -base64 32`");

  const store = db ? await owners(db) : memoryAuthStore();
  const signedIn = createAuth({
    store,
    jwt: { secret },
    cookie: { name: COOKIE, secure: PRODUCTION },
    providers: [
      // google:<sub>, with their name and picture: the intro asks Google for nothing else
      ...(googleClient
        ? [google({ ...googleClient, redirectUri: redirectUri("google", "Google", port), scopes: ["openid", "profile"], failureUrl: "/", user: asReader })]
        : []),
      // github:<id>, with their name, or login, and avatar. No scopes, and a
      // profile of the intro's own, not github()'s, which reads their email
      // addresses too: GitHub answers a sign-in that asks for no scope with
      // every scope the reader granted this app before, user:email included.
      ...(githubClient
        ? [
            oauth2({
              ...githubClient,
              name: "github",
              authorizationEndpoint: "https://github.com/login/oauth/authorize",
              tokenEndpoint: "https://github.com/login/oauth/access_token",
              tokenEndpointAuthMethod: "client_secret_post", // as github() sends the client
              redirectUri: redirectUri("github", "GitHub", port),
              profile: githubReader,
              failureUrl: "/",
              user: asReader,
            }),
          ]
        : []),
    ],
  });
  auth = signedIn;

  return {
    auth: signedIn,
    signIn: [...(googleClient ? ["google"] : []), ...(githubClient ? ["github"] : [])],
    gate: {
      // Without a token, anyone. With one, auth's gate checks it as it would
      // for an app that's signed in throughout, where it came from included.
      async admit(request) {
        const token = tokenOf(request.headers);
        if (!token) return { ok: true, principal: ANYONE };
        const admission = await signedIn.gate.admit(request);
        if (admission.ok && request.route !== "events") remember(await signedIn.verify(token));
        return admission;
      },
      // A conversation no one owns is anyone's, as it is without a gate.
      async allows(principal, conversationId) {
        const owner = await signedIn.ownerOf(conversationId);
        return owner === null || owner === principal;
      },
      // One started signed in is its reader's.
      async created(principal, conversationId) {
        if (principal !== ANYONE) await signedIn.claim(conversationId, principal);
      },
    },
  };
}

/** A provider's client, from `{NAME}_CLIENT_ID` and `{NAME}_CLIENT_SECRET`, where the deployment has both. */
function clientOf(name: "GOOGLE" | "GITHUB"): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[`${name}_CLIENT_ID`];
  const clientSecret = process.env[`${name}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** This site's callback for a provider, from `{NAME}_REDIRECT_URI`: exactly as registered there, never worked out from the request. */
function redirectUri(provider: "google" | "github", label: string, port: number): string {
  const variable = `${provider.toUpperCase()}_REDIRECT_URI`;
  const uri = process.env[variable] ?? (PRODUCTION ? undefined : `http://localhost:${port}/auth/${provider}/callback`);
  if (!uri) throw new Error(`set ${variable} to sign in with ${label}: this site's /auth/${provider}/callback, as registered with ${label}`);
  return uri;
}

/**
 * Who owns which conversation, kept beside the conversations: in memory,
 * they'd be gone on a restart, and a conversation still in the database
 * would be anyone's.
 */
async function owners(db: Queryable): Promise<AuthStore> {
  const { migrate, pgAuthStore } = await import("@haikit/auth/postgres");
  await migrate(db); // creates auth's two tables if they don't exist
  return pgAuthStore(db);
}

/**
 * Who signed in with GitHub, from its `/user` and nothing else: their id, the
 * number that stays when their login changes, their name, or their login when
 * they set none, and their avatar. Never their email addresses.
 */
export async function githubReader(api: ProviderApi): Promise<{ sub: string; claims: Record<string, unknown> }> {
  const user = (await api.get("https://api.github.com/user", { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" })) as Record<string, unknown> | null;
  if (typeof user?.id !== "number") throw new Error("github: GitHub's /user answered with no id");
  const name = typeof user.name === "string" && user.name !== "" ? user.name : user.login;
  return { sub: String(user.id), claims: { name, avatar_url: user.avatar_url } };
}

/**
 * Who signed in, as their token says: `google:<sub>` or `github:<id>`, as
 * auth's own default names them, with their name and the address of their
 * picture, for the header: Google's `picture`, GitHub's `avatar_url`. The
 * picture only from https, as the browser shows it.
 */
export function asReader({ provider, sub, claims }: OidcProfile | OAuth2Profile): SignInAs {
  const { name } = claims;
  const picture = claims.picture ?? claims.avatar_url;
  return {
    userId: `${provider}:${sub}`,
    claims: {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof picture === "string" && picture.startsWith("https://") ? { picture } : {}),
    },
  };
}

/** The name of the reader who started a conversation signed in, if this server has it. */
export async function readerOf(conversationId: string): Promise<string | undefined> {
  const owner = auth && (await auth.ownerOf(conversationId));
  return owner ? names.get(owner) : undefined;
}

/** The token a request carries, read as auth reads it: a Bearer header, else the cookie. */
function tokenOf(headers: Record<string, string | string[] | undefined>): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization ?? ""))?.[1];
  if (bearer) return bearer;
  for (const pair of [headers.cookie ?? []].flat().join(";").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === COOKIE) return pair.slice(at + 1).trim() || null;
  }
  return null;
}

function remember(user: { id: string; claims: Record<string, unknown> } | null) {
  const name = user?.claims.name;
  if (!user || typeof name !== "string") return;
  names.delete(user.id);
  names.set(user.id, name);
  if (names.size > NAMES_KEPT) names.delete(names.keys().next().value!);
}
