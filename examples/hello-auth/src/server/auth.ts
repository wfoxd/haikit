import { randomBytes } from "node:crypto";
import { createAuth, memoryAuthStore } from "@haikit/auth";
import { github } from "@haikit/auth/oauth2";
import { google } from "@haikit/auth/oidc";
import { names } from "./names.ts";

const PRODUCTION = process.env.NODE_ENV === "production";

// The secret tokens are signed with. Without one, a random secret for this run
// only: every sign-in ends when the server stops.
const SECRET = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
if (!SECRET) throw new Error("set HAIKIT_AUTH_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");

// Sign in with Google or GitHub as well, each once there's a client to sign in with there.
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
export const withGoogle = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
export const withGitHub = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);

// signed in as google:<sub> or github:<id>, the provider's id for them, and their name kept to greet them by
function keepName({ provider, sub, claims }: { provider: string; sub: string; claims: Record<string, unknown> }) {
  const userId = `${provider}:${sub}`;
  if (typeof claims.name === "string") names.set(userId, claims.name);
  return userId;
}

export const auth = createAuth({
  // memoryAuthStore keeps owners in this process; pgAuthStore shares them
  store: memoryAuthStore(),
  jwt: { secret: SECRET },
  // Safari keeps no Secure cookie on http://localhost; in production, always Secure
  cookie: { secure: PRODUCTION },
  providers: [
    ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? [
          google({
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            // exactly as registered with Google: never worked out from the request
            redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:5176/auth/google/callback",
            failureUrl: "/sign-in",
            user: keepName,
          }),
        ]
      : []),
    ...(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
      ? [
          github({
            clientId: GITHUB_CLIENT_ID,
            clientSecret: GITHUB_CLIENT_SECRET,
            // exactly as the OAuth App's callback URL
            redirectUri: process.env.GITHUB_REDIRECT_URI ?? "http://localhost:5176/auth/github/callback",
            failureUrl: "/sign-in",
            user: keepName,
          }),
        ]
      : []),
  ],
});
