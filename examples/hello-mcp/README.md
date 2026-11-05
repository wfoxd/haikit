# hello-mcp

Example app — not published. Its tools call three MCP servers with
[`@haikit/mcp`](../../packages/mcp), each as a different identity. The model
never sees an MCP tool: the app's own tools call them, and decide what the
model hears and what the browser shows. It signs in as
[hello-auth](../hello-auth) does, so each conversation has an owner, and a
call in it runs as them.

Run from the repo root:

```bash
npm run example:hello-mcp   # http://localhost:5178
```

Open it at `localhost`, not `127.0.0.1`. Notes sends the browser back to
`http://localhost:5178/mcp/callback`, and the sign-in cookie must come with it.

## The three servers

They are stand-ins, in `src/services/`, started in this process on ports of
their own on 127.0.0.1, so the example runs offline. The app reaches them only
over HTTP, as it would the real ones. `src/server/mcp.ts` makes the
`mcpServer` for each:

| Server | Calls are made as | `@haikit/mcp` |
| --- | --- | --- |
| **Notes**, an MCP server behind its own OAuth authorization server, with dynamic client registration, PKCE, rotating refresh tokens and revocation | each user's own Notes account, which they connect through the app's routes | `mcpAuth.oauth({ issuer })`, with the issuer pinned |
| **Calendar**, which gives each user a key | each user, with the key the app keeps for them | `mcpAuth.bearer((userId) => key)` |
| **Almanac**, with one key for the whole app | the app, whoever the conversation belongs to | `http(url, { headers })`, and no `auth` |

On localhost, Notes registers the app's client by DCR: a client metadata
document needs an https redirect URI.

## What to try

1. **"show my notes"**, before connecting Notes. `show_notes` catches the
   `auth` error and renders the **connect card**, `connect_card`, from
   `err.auth`: its props are `{ server, label, need, href }`, and `href` is
   `err.auth.connect`. The model hears only the digest, `Shown: a button for
   the user to connect Notes. …`: the link goes to the browser, never into
   model text.
2. **Connect Notes**, on the card. Its button opens the link in a popup, from
   the click. The connect route sends it to Notes, where you sign in with any
   name and allow. Notes sends it back to the callback, which stores the
   tokens and answers the done page. The done page posts
   `{ type: "haikit:mcp", server, ok }` to the card and closes
   (`src/client/connect.ts`).
3. **The wake turn.** The callback calls `onConnected`, which sends
   `account_connected`, a wake notice, to the conversation the card was in.
   The model hears `The user connected Notes.`, unasked, and calls
   `show_notes` again.
4. **"note: water the plants".** The approval pattern: the model has no tool
   that writes. `draft_note` shows the note, `note_draft`, and the turn waits.
   Only the handler of its Save click calls Notes' `add_note`, as the
   conversation's owner, keyed by the draft so a click run twice saves once.
5. **Accounts**, in the header. The settings panel lists what
   `GET /mcp/connections` gives, and Disconnect is
   `POST /mcp/disconnect/notes`: Notes revokes the tokens, and the next call
   shows the card again.
6. **"what's on my calendar?"** and **"what day is it?"**. Sign in as another
   name in another browser: Calendar gives that user their own day, Almanac
   everyone the same.

`accounts`, the init tool, reads `mcpAuth.connections(owner)` as each
conversation starts, and tells the model which accounts are connected.

## Where things are

- `src/server/mcp.ts`: `createMcpAuth`, the three servers, and the server
  tools the app declares.
- `src/server/tools.ts`: the model's tools, and `connectCardFor`, which makes
  the card's props from an `auth` error.
- `src/server/surfaces.ts`: the digests, and `note_draft`'s handler, the only
  code that writes to Notes.
- `src/shared/`: the surfaces' and the notice's contracts, which both halves
  import.
- `src/client/components.tsx`: the card, the notes, the draft and the notice.
- `src/client/connect.ts`: the popup, and the done page's message.
- `src/client/accounts.tsx`: the settings panel.

The connect card and `account_connected` belong to this app, not to
`@haikit/mcp`: copy them, and change what you need.

A browser that blocks the popup gets a link to open in a tab instead. Its done
page says `Connected. You can close this window.`, and the notice still wakes
the chat in the first tab.

## Configuration

Uses the scripted model in `src/server/scripted.ts`, so it needs no API key.
Drop `HAI_SCRIPTED=1` and set `ANTHROPIC_API_KEY` to run it against Claude.

- `HAIKIT_AUTH_SECRET` signs the app's sign-in tokens, and
  `HAIKIT_MCP_SECRET` seals every credential `@haikit/mcp` stores. Each is at
  least 32 bytes, such as `openssl rand -base64 32`. Without them, each is
  random for the run, and in production each is required.
- `MCP_REDIRECT_URI` overrides `http://localhost:5178/mcp/callback`. It must be
  https anywhere but localhost.
- `memoryCredentialStore()` keeps the tokens in this process, so a restart
  forgets every connection. `pgCredentialStore(pool)`, from
  `@haikit/mcp/postgres`, keeps them in Postgres and shares them between the
  app's processes.

`npm run smoke` drives all of the above against the built app: the card, the
connect flow through Notes, the wake turn, the approval, each user's
calendar, and disconnecting.
