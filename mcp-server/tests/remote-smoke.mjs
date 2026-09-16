import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.REVEMBER_MCP_URL) throw new Error("Set REVEMBER_MCP_URL to the trusted deployed endpoint.");
const client = new Client({ name: "revember-cloud-read-only-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/remote.js", import.meta.url))],
  env: {
    REVEMBER_MCP_URL: process.env.REVEMBER_MCP_URL,
    ...(process.env.REVEMBER_SESSION_PATH ? { REVEMBER_SESSION_PATH: process.env.REVEMBER_SESSION_PATH } : {})
  },
  stderr: "pipe"
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 13);
  const { resources } = await client.listResources();
  assert.ok(resources.some(resource => resource.uri === "revember://learner/brief"));
  const result = await client.callTool({ name: "get_learner_brief", arguments: {} });
  assert.ok(!result.isError, "Learner brief failed.");
  const text = result.content.find(item => item.type === "text");
  assert.ok(text, "Expected a learner brief.");
  assert.ok(Array.isArray(JSON.parse(text.text).topics));
  // Do not print account identity, tokens, or learning content.
  console.log(`Hosted MCP read-only smoke passed (${tools.length} tools, ${resources.length} resources).`);
} finally {
  await client.close().catch(() => undefined);
}
