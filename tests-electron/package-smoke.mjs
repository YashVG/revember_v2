import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { fixtureArchive, fixtureUserID, installAuthFixture } from "./auth-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = process.env.REVEMBER_APP_BUNDLE
  ? path.resolve(process.env.REVEMBER_APP_BUNDLE)
  : path.join(root, "release", process.arch === "arm64" ? "mac-arm64" : "mac", "Revember.app");
const executablePath = path.join(appBundle, "Contents", "MacOS", "Revember");
await access(executablePath, constants.X_OK);
const mcpDirectory = path.join(appBundle, "Contents", "Resources", "mcp-server");
const mcpRunner = path.join(mcpDirectory, "run-mcp.sh");
const mcpRequire = createRequire(path.join(mcpDirectory, "package.json"));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire("@modelcontextprotocol/sdk/client/stdio.js");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-package-smoke-"));
const knowledgeRoot = path.join(temporaryRoot, "Documents", "RevemberKnowledge");
const userDataPath = path.join(temporaryRoot, "user-data");
const liveSession = Boolean(process.env.REVEMBER_E2E_SESSION_PATH);
await mkdir(userDataPath, { recursive: true });
if (!liveSession) await writeFile(path.join(userDataPath, "legacy-vault-owner.json"), JSON.stringify({ userID: fixtureUserID }));
if (process.env.REVEMBER_E2E_SESSION_PATH) {
  await mkdir(userDataPath, { recursive: true });
  await cp(process.env.REVEMBER_E2E_SESSION_PATH, path.join(userDataPath, "supabase-session.json"));
}
let packagedApp;
let mcpClient;

try {
  packagedApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      HOME: temporaryRoot,
      REVEMBER_PROGRESS_PATH: path.join(temporaryRoot, "progress.json"),
      REVEMBER_USER_DATA_PATH: userDataPath,
      ...(!liveSession ? { REVEMBER_SUPABASE_URL: "https://supabase.fixture.invalid", REVEMBER_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture" } : {})
    }
  });
  if (!liveSession) await installAuthFixture(packagedApp, await fixtureArchive(path.join(appBundle, "Contents", "Resources", "RevemberKnowledge")));
  const metadata = await packagedApp.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion()
  }));
  assert.deepEqual(metadata, { isPackaged: true, name: "Revember", version: "0.2.0" });
  const window = await packagedApp.firstWindow();
  if (!liveSession) {
    await window.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
    assert.equal(await window.getByRole("button", { name: "Home", exact: true }).count(), 0);
    await window.evaluate(() => window.revember.signIn("alice@example.test", "fixture-password"));
  }
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await access(path.join(knowledgeRoot, "topics", "ble.json"), constants.R_OK);
  await access(path.join(knowledgeRoot, "notes", "ble.md"), constants.R_OK);
  await window.locator(".home-topic-list").getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  assert.equal(await window.getByText("Topic overview").isVisible(), true);

  await access(mcpRunner, constants.X_OK);
  mcpClient = new Client({ name: "revember-packaged-mcp-smoke", version: "0.1.0" });
  await mcpClient.connect(new StdioClientTransport({
    command: mcpRunner,
    args: [],
    cwd: mcpDirectory,
    env: {
      REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
      REVEMBER_PROGRESS_PATH: path.join(temporaryRoot, "progress.json")
    },
    stderr: "pipe"
  }));
  const { tools } = await mcpClient.listTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const required of ["upsert_card", "get_learner_brief", "validate_knowledge_base"]) {
    assert.ok(toolNames.has(required), `Packaged MCP server is missing ${required}.`);
  }
  await mcpClient.close();
  mcpClient = undefined;

  const settingsDirectory = path.join(temporaryRoot, "Library", "Application Support", "Revember");
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(path.join(settingsDirectory, "settings.json"), JSON.stringify({
    knowledgeRootPath: knowledgeRoot,
    progressPath: path.join(temporaryRoot, "progress-from-settings.json"),
    notificationsEnabled: false
  }));
  mcpClient = new Client({ name: "revember-packaged-mcp-settings-smoke", version: "0.1.0" });
  await mcpClient.connect(new StdioClientTransport({
    command: mcpRunner,
    args: [],
    cwd: mcpDirectory,
    env: {
      HOME: temporaryRoot,
      PATH: process.env.PATH ?? "/usr/bin:/bin"
    },
    stderr: "pipe"
  }));
  const { resources } = await mcpClient.listResources();
  assert.ok(resources.some((resource) => resource.uri === "revember://learner/brief"));
  console.log(`Packaged Electron smoke passed: ${executablePath}`);
} finally {
  try {
    await mcpClient?.close();
    await packagedApp?.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
