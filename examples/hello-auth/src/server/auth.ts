import { randomBytes } from "node:crypto";
import { createAuth, memoryAuthStore } from "@haikit/auth";

const PRODUCTION = process.env.NODE_ENV === "production";

// The secret tokens are signed with. Without one, a random secret for this run
// only: every sign-in ends when the server stops.
const SECRET = process.env.HAIKIT_AUTH_SECRET ?? (PRODUCTION ? undefined : randomBytes(32).toString("base64url"));
if (!SECRET) throw new Error("set HAIKIT_AUTH_SECRET: at least 32 bytes, such as `openssl rand -base64 32`");

export const auth = createAuth({
  // memoryAuthStore keeps owners in this process; pgAuthStore shares them
  store: memoryAuthStore(),
  jwt: { secret: SECRET },
  // Safari keeps no Secure cookie on http://localhost; in production, always Secure
  cookie: { secure: PRODUCTION },
});
