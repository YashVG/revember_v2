import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RevemberConfig } from "./config.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

export function createServer(config: RevemberConfig): McpServer {
  const server = new McpServer({ name: "revember-mcp-server", version: "0.1.0" });
  registerResources(server, config);
  registerTools(server, config);
  return server;
}
