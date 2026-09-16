import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("../dist/remote.js", import.meta.url));
const initialize = id => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "bridge-test", version: "1" } } });
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const listTools = id => ({ jsonrpc: "2.0", id, method: "tools/list" });

async function runBridge(messages, replies) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-bridge-test-"));
  let child;
  try {
    const sessionPath = path.join(temporaryRoot, "session.json");
    await writeFile(sessionPath, JSON.stringify({ access_token: "fixture-session" }), { mode: 0o600 });
    // Intercept fetch only inside this disposable subprocess. No real session,
    // account, network request, or deployed service is involved in this test.
    const preload = `
      const replies = ${JSON.stringify(replies)};
      let index = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.origin !== "https://bridge.fixture.invalid") throw new Error("Unexpected fixture endpoint");
        if (url.pathname === "/connect") return Response.json({ token: "fixture-mcp-token", expiresAt: Date.now() / 1000 + 900 });
        const request = JSON.parse(init.body);
        const version = new Headers(init.headers).get("MCP-Protocol-Version");
        process.stderr.write(JSON.stringify({ method: request.method, version }) + "\\n");
        if (request.method === "initialize") {
          const result = replies[index++];
          return Response.json({ jsonrpc: "2.0", id: request.id, ...result });
        }
        if (request.id === undefined) return new Response(null, { status: 202 });
        return Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
      };
    `;
    child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, helperPath], {
      env: { ...process.env, REVEMBER_MCP_URL: "https://bridge.fixture.invalid/mcp", REVEMBER_SESSION_PATH: sessionPath },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error(`Bridge exited ${code}: ${stderr}`)));
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      child.stdin.end(messages.map(message => JSON.stringify(message)).join("\n") + "\n");
      await completed;
    } finally { clearTimeout(timeout); }
    return {
      requests: stderr.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
      responses: stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

for (const version of ["2025-11-25", "2025-06-18"]) {
  test(`bridge forwards negotiated ${version} on notifications and requests`, async () => {
    const result = await runBridge([initialize(1), initialized, listTools(2)], [{ result: { protocolVersion: version } }]);
    assert.deepEqual(result.requests, [
      { method: "initialize", version: null },
      { method: "notifications/initialized", version },
      { method: "tools/list", version }
    ]);
    assert.deepEqual(result.responses.map(response => response.id), [1, 2], "Notifications must not produce stdout responses");
    assert.equal(result.responses[0].result.protocolVersion, version);
  });
}

test("bridge replaces the negotiated version on a new successful initialization", async () => {
  const result = await runBridge([initialize(1), listTools(2), initialize(3), initialized, listTools(4)], [
    { result: { protocolVersion: "2025-11-25" } }, { result: { protocolVersion: "2025-06-18" } }
  ]);
  assert.deepEqual(result.requests.map(request => request.version), [null, "2025-11-25", null, "2025-06-18", "2025-06-18"]);
});

test("failed initialization does not preserve or adopt a negotiated version", async () => {
  const result = await runBridge([initialize(1), listTools(2), initialize(3), listTools(4)], [
    { result: { protocolVersion: "2025-11-25" } },
    { error: { code: -32600, message: "Initialization rejected" }, result: { protocolVersion: "2025-06-18" } }
  ]);
  assert.deepEqual(result.requests.map(request => request.version), [null, "2025-11-25", null, null]);
  assert.equal(result.responses[2].error.message, "Initialization rejected");
});

test("initialization without a usable protocol version fails clearly", async () => {
  const result = await runBridge([initialize(1)], [{ result: {} }]);
  assert.match(result.responses[0].error.message, /protocol version/i);
});
