import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(packageRoot, "dist", "index.js");
const repositoryRoot = path.resolve(packageRoot, "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-mcp-stdio-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
const client = new Client({ name: "revember-stdio-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: packageRoot,
  env: {
    REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
    REVEMBER_PROGRESS_PATH: path.join(temporaryRoot, "progress.json")
  },
  stderr: "pipe"
});

function textPayload(result) {
  const content = result.content.find((item) => item.type === "text");
  assert.ok(content, "Expected a text tool result.");
  return JSON.parse(content.text);
}

try {
  await cp(path.join(repositoryRoot, "RevemberKnowledge"), knowledgeRoot, { recursive: true });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const required of [
    "capture_learning_session",
    "upsert_concept",
    "upsert_card",
    "retire_card",
    "get_learner_brief",
    "validate_knowledge_base",
    "search_knowledge"
  ]) {
    assert.ok(toolNames.has(required), `Missing MCP tool: ${required}`);
  }

  const { resources } = await client.listResources();
  const resourceURIs = new Set(resources.map((resource) => resource.uri));
  assert.ok(resourceURIs.has("revember://topics"));
  assert.ok(resourceURIs.has("revember://sessions"));
  assert.ok(resourceURIs.has("revember://learner/brief"));
  assert.ok(resourceURIs.has("revember://validation"));

  const { resourceTemplates } = await client.listResourceTemplates();
  const templates = new Set(resourceTemplates.map((template) => template.uriTemplate));
  assert.ok(templates.has("revember://topic/{slug}"));
  assert.ok(templates.has("revember://session/{id}"));

  const validation = textPayload(await client.callTool({
    name: "validate_knowledge_base",
    arguments: {}
  }));
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const learnerBrief = textPayload(await client.callTool({
    name: "get_learner_brief",
    arguments: {}
  }));
  assert.ok(Array.isArray(learnerBrief.topics));

  console.log(`Revember stdio MCP smoke passed (${tools.length} tools, ${resources.length} resources).`);
} finally {
  await client.close().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
