#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const endpoint = new URL(process.env.REVEMBER_MCP_URL ?? "https://invalid.example/mcp");
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/mcp" || endpoint.search || endpoint.hash || endpoint.hostname === "invalid.example") {
  throw new Error("Set REVEMBER_MCP_URL to your deployed HTTPS /mcp endpoint.");
}
const sessionPath = process.env.REVEMBER_SESSION_PATH ?? path.join(homedir(), "Library", "Application Support", "Revember", "supabase-session.json");
let cached: { source: string; token: string; expiresAt: number } | undefined;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;
  let message: { id?: string | number; method?: string };
  try { message = JSON.parse(line); } catch { continue; }
  try {
    // Always reread the app-owned session: sign-out and account changes must
    // immediately stop reuse. The app alone owns refresh-token rotation.
    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    if (typeof session.access_token !== "string") throw new Error("Sign in to Revember first.");
    if (!cached || cached.source !== session.access_token || cached.expiresAt <= Date.now() / 1000 + 20) {
      const response = await fetch(new URL("/connect", endpoint), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: session.access_token }), redirect: "error", signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error("Cloud connection failed. Open Revember and sign in again.");
      const value = await response.json() as { token: string; expiresAt: number };
      cached = { ...value, source: session.access_token };
    }
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${cached.token}` },
      body: line, redirect: "error", signal: AbortSignal.timeout(30_000)
    });
    const result = await response.text();
    if (response.status === 401) cached = undefined;
    if (message.id !== undefined) {
      if (!result) throw new Error(`Hosted MCP returned HTTP ${response.status}.`);
      const parsed = JSON.parse(result);
      if (parsed.jsonrpc !== "2.0") throw new Error(`Hosted MCP returned HTTP ${response.status}.`);
      process.stdout.write(`${JSON.stringify(parsed)}\n`);
    }
  } catch (error) {
    if (message.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : "Cloud MCP request failed." } })}\n`);
  }
}
