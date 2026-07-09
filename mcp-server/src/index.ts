#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ensureKnowledgeDirs } from "./paths.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureKnowledgeDirs(config);

  const server = new McpServer({
    name: "revember-mcp-server",
    version: "0.1.0"
  });

  registerResources(server, config);
  registerTools(server, config);

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
