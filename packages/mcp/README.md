# @haikit/mcp

Call an MCP server's tools from inside your own HaiKIT tools.

The model never sees an MCP tool. You declare the server tools your app may
call, typed by schemas you own, and call them from a tool's `run` or an action
handler, as you would a database. Your tool decides what the model hears of
the result and what the browser shows. Nothing a third-party server says
reaches the model unless your code puts it there: not its tools' names or
descriptions, not its instructions, and not its results.

```ts
import { mcpServer, http } from "@haikit/mcp";
import { defineTool } from "@haikit/core";
import { z } from "zod";

const github = mcpServer({
  name: "github",
  transport: http("https://api.example.com/mcp", { headers: { Authorization: `Bearer ${token}` } }),
});

// each server tool the app may call, checked both ways by your schemas
const searchIssues = github.tool("search_issues", {
  args: z.object({ q: z.string(), per_page: z.number() }),
  result: z.object({ items: z.array(Issue) }),
});

// what the model sees is yours: the name, the description, the schema
export const findIssues = defineTool({
  name: "find_issues",
  description: "Search this project's issues.",
  input: z.object({ query: z.string() }),
  inputJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async run({ query }, ctx) {
    const { items } = await searchIssues.call({ q: `repo:acme/app ${query}`, per_page: 50 }, ctx);
    return ctx.render(issueList, { issues: items }); // rows to the browser, the digest to the model
  },
});

await github.connect(); // at startup: stops here if a declared tool isn't on the server
```

- `stdio({ command, args })` starts a local server as a child process instead.
  The child gets only a short list of safe environment variables, not yours.
- A call throws `McpToolError` when the tool reports an error, and `McpError`
  when there's no result: bad args, a result your schema refuses, a timeout,
  a lost connection, a refusal. The message names only the server and the
  tool. What the server said is on `err.text`, so a tool that lets the error
  through doesn't pass the server's words to the model.
- Progress from the server reaches `ctx.progress`, and keeps a long call alive.
  A call times out after 30 s without word from the server, and after 90 s in
  all, connecting included, inside the 120 s turn lease.
- `textOf(result)` turns a result into text, for a tool that decides to pass
  some of it on. A cut is always marked in the text.

`McpTool` isn't a HaiKIT `Tool`, so it can't be passed to
`createHai({ tools })`: `npm run typetest` checks that.

Imports only `@haikit/core`, never `@haikit/server`. Built on
[`@modelcontextprotocol/client`](https://www.npmjs.com/package/@modelcontextprotocol/client),
the official TypeScript SDK's client.

Everything it does, with every default and message:
[the reference manual](https://github.com/wfoxd/haikit/blob/main/docs/reference/mcp.md).
