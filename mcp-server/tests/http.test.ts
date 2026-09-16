import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpHandler } from "../src/http.js";
import { authenticate, exchangeToken, type CloudOptions } from "../src/cloud-auth.js";
import { validateArchive, withTemporaryVault, type CloudArchive } from "../src/cloud-vault.js";
import { access } from "node:fs/promises";
import { handler as lambdaHandler } from "../src/lambda.js";

function fixture() {
  const users = [randomUUID(), randomUUID()];
  const backendUrl = "https://project.supabase.co";
  const tokens = users.map(sub => `header.${Buffer.from(JSON.stringify({ sub, aud: "authenticated", role: "authenticated", iss: `${backendUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`);
  const empty: CloudArchive = { schemaVersion: 1, exportedAt: new Date().toISOString(), files: {}, progress: {}, planner: { preserveMe: true } };
  const rows = new Map(users.map(id => [id, { revision: 1, vault: structuredClone(empty) }]));
  let conflict = false;
  let reads = 0;
  const options: CloudOptions = {
    supabaseUrl: backendUrl, publishableKey: "public-test-key", tokenSecret: "a".repeat(64), audience: "https://mcp.example.com/mcp",
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const token = headers.get("authorization")?.replace("Bearer ", "");
      const id = users[tokens.indexOf(token ?? "")];
      if (!id) return Response.json({ message: "unauthorized" }, { status: 401 });
      assert.equal(headers.get("apikey"), "public-test-key");
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") return Response.json({ id });
      reads++;
      // Simulate the actual per-user RLS boundary, not a privileged backend.
      assert.equal(url.searchParams.get("user_id"), `eq.${id}`);
      const row = rows.get(id);
      if (init?.method === "PATCH") {
        const write = JSON.parse(init.body as string);
        if (!row || conflict || url.searchParams.get("revision") !== `eq.${row.revision}`) return Response.json([]);
        rows.set(id, { revision: write.revision, vault: write.vault });
        return Response.json([{ revision: write.revision }]);
      }
      return Response.json(row ? [row] : []);
    }
  };
  const handle = createHttpHandler(options);
  const request = (pathname: string, body: unknown, token?: string, extra: Record<string, string> = {}) => handle(new Request(`https://mcp.example.com${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body)
  }));
  return { options, handle, request, rows, users, tokens, empty, setConflict: () => { conflict = true; }, reads: () => reads };
}

test("authentication fails closed before reading any vault", async () => {
  const f = fixture();
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  for (const token of [undefined, "fake", f.tokens[0]]) assert.equal((await f.request("/mcp", rpc, token)).status, 401);
  assert.equal((await f.request("/connect", { accessToken: "fake" })).status, 401);
  assert.equal(f.reads(), 0);
  const connected = await f.request("/connect", { accessToken: f.tokens[0] });
  assert.equal(connected.status, 200);
  const { token } = await connected.json();
  assert.equal(authenticate(f.options, token).userID, f.users[0]);
  assert.ok(!token.includes(f.tokens[0]!));
  assert.throws(() => authenticate({ ...f.options, audience: "https://another.example/mcp" }, token));
  assert.throws(() => authenticate(f.options, `${token.slice(0, -10)}tamperedAA`));
  assert.throws(() => authenticate({ ...f.options, tokenSecret: "b".repeat(64) }, token));
});

test("MCP credentials require a full authentication tag and the issued nonce size", async () => {
  const f = fixture();
  const { token } = await exchangeToken(f.options, f.tokens[0]!);
  const parts = token.split(".");
  const tag = Buffer.from(parts[3]!, "base64url");
  assert.equal(tag.length, 16);
  assert.equal(authenticate(f.options, token).userID, f.users[0]);
  for (let size = 0; size < 16; size++) {
    const shortened = [...parts];
    shortened[3] = tag.subarray(0, size).toString("base64url");
    assert.throws(() => authenticate(f.options, shortened.join(".")), `Accepted a ${size}-byte authentication tag`);
  }
  const oversized = [...parts];
  oversized[3] = Buffer.concat([tag, Buffer.from([0])]).toString("base64url");
  assert.throws(() => authenticate(f.options, oversized.join(".")));
  const short = [...parts];
  short[3] = tag.subarray(0, 4).toString("base64url");
  assert.equal((await f.request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, short.join("."))).status, 401);
  assert.equal(f.reads(), 0, "Malformed credentials must not reach a vault");

  // A cryptographically valid token with a different IV length must also fail
  // the fixed rv1 format, rather than relying on failed decryption to reject it.
  const nonce = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(f.options.tokenSecret).digest(), nonce);
  cipher.setAAD(Buffer.from("revember-mcp-v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(authenticate(f.options, token))), cipher.final()]);
  const wrongNonce = ["rv1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  assert.throws(() => authenticate(f.options, wrongNonce));
  for (const malformed of [`${token}.`, `${token}!`, `${token}=`]) assert.throws(() => authenticate(f.options, malformed));
});

test("MCP credentials expire and Lambda preserves its trusted gateway boundary", async context => {
  const f = fixture();
  const { token, expiresAt } = await exchangeToken(f.options, f.tokens[0]!);
  assert.ok(expiresAt <= Math.floor(Date.now() / 1000) + 900);
  context.mock.method(Date, "now", () => (expiresAt + 1) * 1000);
  assert.throws(() => authenticate(f.options, token));
  context.mock.restoreAll();
  const variables = {
    REVEMBER_MCP_AUDIENCE: f.options.audience,
    REVEMBER_SUPABASE_URL: f.options.supabaseUrl,
    REVEMBER_SUPABASE_PUBLISHABLE_KEY: f.options.publishableKey,
    REVEMBER_MCP_TOKEN_SECRET: f.options.tokenSecret
  };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  try {
    const event = { rawPath: "/health", headers: {}, requestContext: { http: { method: "GET" }, domainName: "mcp.example.com" } };
    const healthy = await lambdaHandler(event);
    assert.equal(healthy.statusCode, 200);
    assert.equal(JSON.parse(healthy.body).status, "ok");
    assert.equal((await lambdaHandler({ ...event, requestContext: { ...event.requestContext, domainName: "wrong.example" } })).statusCode, 403);
    const unauthenticated = await lambdaHandler({ ...event, rawPath: "/mcp", headers: { "content-type": "application/json" }, body: Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}').toString("base64"), isBase64Encoded: true, requestContext: { ...event.requestContext, http: { method: "POST" } } });
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("real MCP client initializes, persists tools, isolates users, and reports conflicts", async () => {
  const f = fixture();
  const { token } = await exchangeToken(f.options, f.tokens[0]!);
  const client = new Client({ name: "remote-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.options.audience), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => f.handle(new Request(input, init))
  }));
  try {
    assert.equal((await client.listTools()).tools.length, 13);
    const created = await client.callTool({ name: "create_topic", arguments: { slug: "cloud-test", title: "Cloud test", summary: "Persisted in the account vault", concepts: [{ title: "Cloud storage", body: "A cloud vault persists between requests." }], markdownBody: "# Cloud test" } });
    assert.ok(!created.isError, JSON.stringify(created));
    const row = f.rows.get(f.users[0]!)!;
    assert.equal(row.revision, 2);
    assert.ok(row.vault.files["topics/cloud-test.json"]);
    assert.deepEqual(row.vault.planner, { preserveMe: true });
    assert.deepEqual(row.vault.progress, {});
    assert.deepEqual(f.rows.get(f.users[1]!)!.vault.files, {});
    const topic = await client.readResource({ uri: "revember://topic/cloud-test" });
    assert.ok(JSON.stringify(topic).includes("Cloud test"));
    const other = await exchangeToken(f.options, f.tokens[1]!);
    const response = await f.request("/mcp", { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "revember://topic/cloud-test" } }, other.token);
    assert.ok((await response.json()).error);
    const invalid = await client.callTool({ name: "create_topic", arguments: { slug: "../escape", title: "Bad", summary: "Bad", concepts: [] } });
    assert.ok(invalid.isError);
    assert.equal(f.rows.get(f.users[0]!)!.revision, 2);
    f.setConflict();
    const failed = await f.request("/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "update_topic", arguments: { slug: "cloud-test", expectedRevision: 1, patch: { title: "Must not save" } } } }, token);
    assert.equal(failed.status, 409);
    assert.equal(f.rows.get(f.users[0]!)!.revision, 2);
    assert.ok(!f.rows.get(f.users[0]!)!.vault.files["topics/cloud-test.json"]!.includes("Must not save"));
  } finally { await client.close(); }
});

test("origins, invalid requests, and missing uploaded vaults have useful errors", async () => {
  const f = fixture();
  assert.equal((await f.request("/mcp", {}, undefined, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.handle(new Request("https://wrong.example/health"))).status, 403);
  assert.equal((await f.handle(new Request("https://mcp.example.com/mcp"))).status, 405);
  assert.equal((await f.handle(new Request("https://mcp.example.com/health"))).status, 200);
  assert.equal((await f.request("/mcp", [])).status, 400);
  assert.equal((await f.request("/mcp", { huge: "x".repeat(1_000_001) })).status, 413);
  const { token } = await exchangeToken(f.options, f.tokens[0]!);
  f.rows.delete(f.users[0]!);
  const missing = await f.request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
  assert.equal(missing.status, 409);
  assert.ok((await missing.text()).includes("Upload your vault"));
});

test("vault extraction rejects traversal, collisions, and oversize input; temporary files are removed", async () => {
  const f = fixture();
  for (const name of ["../escape.json", "topics/../../escape.json", "/tmp/escape.json", "topics/a\\b.json", "topics/.secret.json", "topics/a:stream.json"]) {
    assert.throws(() => validateArchive({ ...f.empty, files: { [name]: "{}" } }));
  }
  assert.throws(() => validateArchive({ ...f.empty, files: { "notes/A.md": "a", "notes/a.md": "b" } }));
  assert.throws(() => validateArchive({ ...f.empty, files: { "notes/a.md": "a", "notes/a.md/b.md": "b" } }));
  assert.throws(() => validateArchive({ ...f.empty, files: { "notes/big.md": "x".repeat(7_500_000) } }));
  let temporaryPath = "";
  await assert.rejects(withTemporaryVault(f.empty, async config => { temporaryPath = config.knowledgeRoot; throw new Error("test failure"); }));
  await assert.rejects(access(temporaryPath));
});
