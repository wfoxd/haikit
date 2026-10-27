import { randomBytes } from "node:crypto";
import type { Gate } from "@haikit/core";
import { type Auth, createAuth, memoryAuthStore } from "@haikit/auth";
import { google } from "@haikit/auth/oidc";
import type { Queryable } from "@haikit/auth/postgres";

// Sign in with Google, once the deployment has a Google client to sign in
// with. It's optional for the reader: signed out, anyone reads the
// introduction, as without it. Signed in, the conversations they start are
// theirs alone, and the welcome greets them by name.
const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
const PRODUCTION = process.env.NODE_ENV === "production";

// The token's cookie, named here because the gate looks for it: auth's
// default, `__Host-` only where it's Secure (Safari keeps no Secure cookie on
// http://localhost).
const COOKIE = PRODUCTION ? "__Host-haikit_token" : "haikit_token";

// A reader who isn't signed in. Never a user's id: those are google:<sub>.
const ANYONE = "anyone";

// Each signed-in reader's name, from their token, for the welcome: by user
// id, the latest 10,000.
const NAMES_KEPT = 10_000;
const names = new Map<string, string>();

let auth: Auth | null = null;

/** The sign-in routes and the gate, or null without a Google client. */
export async function googleSignIn(db: Queryable | null, port: number): Promise<{ auth: Auth; gate: Gate } | null> {
  if (!clientId || !clientSecret) return null;

  // The secret tokens are signed with. Without one, a random secret for this
  // run only: every sign-in ends when the server stops.
  const secret = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
  if (!secret) throw new Error("set HAIKIT_AUTH_SECRET to sign in with Google: at least 32 bytes, such as `openssl rand -base64 32`");
  // exactly as registered with Google: never worked out from the request
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? (PRODUCTION ? undefined : `http://localhost:${port}/auth/google/callback`);
  if (!redirectUri) throw new Error("set GOOGLE_REDIRECT_URI to sign in with Google: this site's /auth/google/callback, as registered with Google");

  // Owners kept beside the conversations: in memory, they'd be gone on a
  // restart, and a conversation still in the database would be anyone's.
  let store = memoryAuthStore();
  if (db) {
    const { migrate, pgAuthStore } = await import("@haikit/auth/postgres");
    await migrate(db); // creates auth's two tables if they don't exist
    store = pgAuthStore(db);
  }

  const signedIn = createAuth({
    store,
    jwt: { secret },
    cookie: { name: COOKIE, secure: PRODUCTION },
    providers: [
      // google:<sub>, with their name: the intro asks Google for nothing else
      google({ clientId, clientSecret, redirectUri, scopes: ["openid", "profile"], failureUrl: "/" }),
    ],
  });
  auth = signedIn;

  return {
    auth: signedIn,
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
