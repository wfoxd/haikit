/**
 * The app against a stand-in for GitHub, so it runs offline, with no GitHub
 * App to register: `npm run mock`, and the smoke test. The stand-in starts
 * first, then the app, configured for it by the same environment that
 * configures it for the real GitHub.
 */

import { startGitHub } from "./stand-in/github.ts";

const PORT = Number(process.env.PORT) || 5179;

const github = await startGitHub({
  appName: "hello-github",
  // the GitHub App's callback URL: where the app's redirect URI comes back
  callbackUrl: process.env.MCP_REDIRECT_URI ?? `http://localhost:${PORT}/mcp/callback`,
  // GitHub's tokens last 8 hours; the smoke test makes them shorter, to see one refreshed
  tokenSeconds: Number(process.env.GITHUB_STAND_IN_TOKEN_SECONDS) || undefined,
});
process.env.GITHUB_MCP_URL = github.url;
process.env.GITHUB_MCP_ISSUER = github.issuer;
process.env.GITHUB_APP_CLIENT_ID = github.client.id;
process.env.GITHUB_APP_CLIENT_SECRET = github.client.secret;
console.log(`stand-in GitHub  ${github.issuer}   MCP ${github.url}`);

// Imported once the environment is set: ./server/github.ts reads it as it loads.
await import("./server/main.ts");
