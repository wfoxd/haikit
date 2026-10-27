import { randomBytes } from "node:crypto";
import { createAuth, memoryAuthStore } from "@haikit/auth";
import { google } from "@haikit/auth/oidc";
import { names } from "./names.ts";

const PRODUCTION = process.env.NODE_ENV === "production";

// The secret tokens are signed with. Without one, a random secret for this run
// only: every sign-in ends when the server stops.
const SECRET = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
if (!SECRET) throw new Error("set HAIKIT_AUTH_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");

// Sign in with Google as well, once there's a Google client to sign in with.
const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
export const withGoogle = Boolean(clientId && clientSecret);

export const auth = createAuth({
  // memoryAuthStore keeps owners in this process; pgAuthStore shares them
  store: memoryAuthStore(),
  jwt: { secret: SECRET },
  // Safari keeps no Secure cookie on http://localhost; in production, always Secure
  cookie: { secure: PRODUCTION },
  providers:
    clientId && clientSecret
      ? [
          google({
            clientId,
            clientSecret,
            // exactly as registered with Google: never worked out from the request
            redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:5176/auth/google/callback",
            failureUrl: "/sign-in",
            // signed in as google:<sub>, Google's id for them, and their name kept to greet them by
            user({ provider, sub, claims }) {
              const userId = `${provider}:${sub}`;
              if (typeof claims.name === "string") names.set(userId, claims.name);
              return userId;
            },
          }),
        ]
      : [],
});
