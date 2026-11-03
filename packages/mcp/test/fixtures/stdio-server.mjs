/**
 * A small MCP server over stdio, for packages/mcp/test/mcp.mjs: its pid and
 * the environment it was given, and a tool that ends the process mid-call.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "stdio-fixture", version: "1.0.0" });
server.registerTool("whoami", { inputSchema: z.object({}) }, async () => {
  const self = { pid: process.pid, env: Object.keys(process.env).sort() };
  return { content: [{ type: "text", text: JSON.stringify(self) }], structuredContent: self };
});
server.registerTool("die", { inputSchema: z.object({}) }, async () => {
  setTimeout(() => process.exit(1), 5);
  return new Promise(() => {});
});
await server.connect(new StdioServerTransport());
