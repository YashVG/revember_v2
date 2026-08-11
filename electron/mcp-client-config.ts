import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { McpClient, McpConnectionResult } from "../shared/types";
import { writeJsonAtomically, writeTextAtomically } from "./persistence";

export type { McpClient, McpConnectionResult } from "../shared/types";
export type McpConnectionAction = "connect" | "disconnect";

export interface McpConnection {
  runnerPath: string;
}

export interface McpClientConfigPaths {
  codex: string;
  claude: string;
}

export function defaultMcpClientConfigPaths(): McpClientConfigPaths {
  const home = homedir();
  return {
    codex: path.join(home, ".codex", "config.toml"),
    claude: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
  };
}

export function configureMcpClient(
  client: McpClient,
  action: McpConnectionAction,
  connection: McpConnection,
  configPaths = defaultMcpClientConfigPaths()
): McpConnectionResult {
  if (client !== "codex" && client !== "claude") {
    throw new Error("Choose either Codex or Claude for the Revember connection.");
  }
  if (action !== "connect" && action !== "disconnect") {
    throw new Error("MCP connection action is invalid.");
  }

  const configPath = configPaths[client];
  if (client === "codex") updateCodexConfig(configPath, action, connection);
  else updateClaudeConfig(configPath, action, connection);
  return { client, action, configPath };
}

function updateCodexConfig(configPath: string, action: McpConnectionAction, connection: McpConnection): void {
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const withoutRevember = removeTomlTables(current, "mcp_servers.revember");
  if (action === "disconnect") {
    if (withoutRevember !== current) writeToml(configPath, withoutRevember);
    return;
  }

  const block = [
    "[mcp_servers.revember]",
    `command = ${tomlString(connection.runnerPath)}`,
    "args = []",
    'default_tools_approval_mode = "writes"',
    "startup_timeout_sec = 10"
  ].join("\n");
  writeToml(configPath, `${withoutRevember.trimEnd()}${withoutRevember.trim() ? "\n\n" : ""}${block}\n`);
}

function updateClaudeConfig(configPath: string, action: McpConnectionAction, connection: McpConnection): void {
  if (!existsSync(configPath) && action === "disconnect") return;
  const raw = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Claude's MCP configuration must contain a JSON object.");
  }
  const config = raw as Record<string, unknown>;
  const currentServers = config.mcpServers;
  if (currentServers !== undefined && (!currentServers || typeof currentServers !== "object" || Array.isArray(currentServers))) {
    throw new Error("Claude's mcpServers configuration must contain a JSON object.");
  }
  const mcpServers = { ...(currentServers as Record<string, unknown> | undefined) };
  if (action === "connect") {
    mcpServers.revember = {
      command: connection.runnerPath,
      args: []
    };
    config.mcpServers = mcpServers;
  } else {
    delete mcpServers.revember;
    if (Object.keys(mcpServers).length === 0) delete config.mcpServers;
    else config.mcpServers = mcpServers;
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeJsonAtomically(configPath, config);
}

function writeToml(configPath: string, contents: string): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeTextAtomically(configPath, contents);
}

function removeTomlTables(source: string, tablePrefix: string): string {
  const lines = source.split("\n");
  let skipping = false;
  const retained: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (match) {
      skipping = match[1] === tablePrefix || match[1].startsWith(`${tablePrefix}.`);
    }
    if (!skipping) retained.push(line);
  }
  return retained.join("\n").replace(/\n{3,}/g, "\n\n");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
