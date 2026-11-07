# hello-github

Example app — not published. The finished app of the fourth tutorial,
*On their behalf* (`docs/tutorial-4.md`): [hello-auth](../hello-auth), with
two tools that search and read GitHub's issues through
[GitHub's MCP server](https://github.com/github/github-mcp-server), as each
user, with the GitHub account they connect. It calls the server with
[`@haikit/mcp`](../../packages/mcp), connecting through a GitHub App.

Run from the repo root:

```bash
npm run example:hello-github   # http://localhost:5179
```

That runs it offline, against a stand-in for GitHub, with the scripted model.
Open it at `localhost`, not `127.0.0.1`: the sign-in sends the browser back to
`http://localhost:5179/mcp/callback`, and the sign-in cookie must come with it.

## Against GitHub itself

Register a GitHub App, as the tutorial's step 02 does, with:

- **Callback URL** `http://localhost:5179/mcp/callback`;
- **Expire user authorization tokens** left on, and **Webhook** off;
- **Repository permissions → Issues**: Read-only.

Then put its client ID and a client secret in `examples/hello-github/.env`:

```bash
GITHUB_APP_CLIENT_ID=…
GITHUB_APP_CLIENT_SECRET=…
```

and run `npm run mock` in `examples/hello-github` for the stand-in, or:

```bash
npm --prefix examples/hello-github run dev   # GitHub itself, and Claude: needs ANTHROPIC_API_KEY
HAI_SCRIPTED=1 npm --prefix examples/hello-github run dev   # GitHub itself, and the scripted model
```

The sign-in takes any name, with no password, and whoever signs in as a name
uses the GitHub account connected to it. So the server listens on `127.0.0.1`
only: keep it so, and connect only an account you'd let anyone at this machine
use. A real login goes in before it listens anywhere else.

The scripted model knows a request such as *"find issues about tutorial in
wfoxd/haikit"* or *"read issue 187 in wfoxd/haikit"*. A GitHub App reads public
repositories as any user can; a private one only once it's installed there.

## What to try

1. **"find issues about hebrew in haikit-demo/greetings"**, before connecting.
   `find_issues` catches the `auth` error and renders the **connect card**:
   `connectCardFor(err, "GitHub")` gives `{ server, label, need, href }`. The
   model hears the digest, never the link.
2. **Connect GitHub**, on the card. Its popup goes to GitHub's sign-in, as the
   GitHub App, asking for `offline_access` and nothing more: what a GitHub App
   may do is its permissions, not scopes. Authorize it, and the callback trades
   the code for tokens, with the app's client secret.
3. **The wake turn.** `onConnected` sends `accountConnected`, a wake notice, to
   the conversation. The model hears `The user connected GitHub.`, and calls
   `find_issues` again.
4. **"read issue 7 in haikit-demo/greetings".** `read_issue` declares
   `issue_read` with no result schema, and passes the model `textOf` its text,
   cut at 4,000 characters. Issue 7's body asks the model for the user's
   token: anyone can write an issue.
5. **"find issues about bugs in haikit-demo/nowhere"**, or **"read issue 99 in
   haikit-demo/greetings"**. GitHub's server runs the tool and reports an
   error, an `McpToolError`: the model hears this app's words, and GitHub's go
   to the log.
6. **Sign in as another name.** Their searches ask them to connect their own
   GitHub account.

## Where things are

- `src/server/github.ts`: `createMcpAuth`, the `mcpServer` for GitHub with
  `oauth({ issuer, scopes, client })`, and the two tools of GitHub's it calls,
  each with the app's own schemas.
- `src/server/tools.ts`: `find_issues` and `read_issue`, and `welcome`, which
  says whether GitHub is connected.
- `src/server/surfaces.ts`: what the model hears of the connect card and of
  the issues found. `src/server/notices.ts`: what it hears of the notice.
- `src/client/components.tsx`: the card, the issues and the notice.
  `src/client/connect.ts`: the popup.
- `src/stand-in/github.ts`: the stand-in, on two ports of its own on
  127.0.0.1: GitHub's MCP server at `/mcp/x/issues/readonly`, and its sign-in
  at `/login/oauth`, with GitHub's metadata, its token lifetimes, its rotating
  refresh tokens and its error codes. `src/offline.ts` starts it, then the
  app, configured for it.

## Configuration

- `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`, the GitHub App's.
  `src/offline.ts` sets them for the stand-in's.
- `GITHUB_MCP_URL` and `GITHUB_MCP_ISSUER` override GitHub's,
  `https://api.githubcopilot.com/mcp/x/issues/readonly` and
  `https://github.com/login/oauth`.
- `HAIKIT_AUTH_SECRET` signs the app's sign-in tokens, and
  `HAIKIT_MCP_SECRET` seals the GitHub tokens `@haikit/mcp` stores. Each is at
  least 32 bytes, such as `openssl rand -base64 32`. Without them, each is
  random for the run, and in production each is required.
- `MCP_REDIRECT_URI` overrides `http://localhost:5179/mcp/callback`. It must
  be https anywhere but localhost, and the GitHub App's callback URL.
- `memoryCredentialStore()` keeps the tokens in this process, so a restart
  forgets every connection.
- The server listens on `127.0.0.1`, this machine only, since the sign-in
  takes any name.

`npm run smoke` drives the offline app: the card, the connect flow through the
stand-in, the wake turn, reading an issue, GitHub's refusals, two refreshes of
tokens that expire after 2 seconds, and disconnecting.
