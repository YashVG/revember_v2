#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ensureKnowledgeDirs } from "./paths.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureKnowledgeDirs(config);

  const server = createServer(config);

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
