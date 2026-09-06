import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureMcpClient, type McpClientConfigPaths, type McpConnection } from "../electron/mcp-client-config";

const temporaryRoots: string[] = [];
const connection: McpConnection = {
  runnerPath: "/Applications/Revember.app/Contents/Resources/mcp-server/run-mcp.sh"
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("MCP client connection configuration", () => {
  it("pins a newly connected MCP client to the selected account's vault", async () => {
    const paths = await configPaths();
    const account = { ...connection, knowledgeRootPath: "/accounts/bob/knowledge", progressPath: "/accounts/bob/progress.json" };
    configureMcpClient("codex", "connect", account, paths);
    expect(await fs.readFile(paths.codex, "utf8")).toContain('REVEMBER_KNOWLEDGE_ROOT = "/accounts/bob/knowledge"');
    configureMcpClient("claude", "connect", account, paths);
    expect(JSON.parse(await fs.readFile(paths.claude, "utf8")).mcpServers.revember.env).toEqual({
      REVEMBER_KNOWLEDGE_ROOT: account.knowledgeRootPath, REVEMBER_PROGRESS_PATH: account.progressPath
    });
  });
  it("adds, updates, and removes only Revember's Codex MCP tables", async () => {
    const paths = await configPaths();
    await fs.mkdir(path.dirname(paths.codex), { recursive: true });
    await fs.writeFile(paths.codex, [
      'model = "gpt-5"',
      "",
      "[mcp_servers.github]",
      'command = "github-mcp"',
      "",
      "[mcp_servers.revember]",
      'command = "old-runner"',
      "",
      "[mcp_servers.revember.env]",
      'REVEMBER_KNOWLEDGE_ROOT = "/old"',
      "",
      "[features]",
      "experimental = true",
      ""
    ].join("\n"));

    const connected = configureMcpClient("codex", "connect", connection, paths);
    expect(connected).toEqual({ client: "codex", action: "connect", configPath: paths.codex });
    const configured = await fs.readFile(paths.codex, "utf8");
    expect(configured).toContain('model = "gpt-5"');
    expect(configured).toContain("[mcp_servers.github]");
    expect(configured).toContain("[features]");
    expect(configured).toContain(`command = ${JSON.stringify(connection.runnerPath)}`);
    expect(configured).toContain('default_tools_approval_mode = "writes"');
    expect(configured.match(/\[mcp_servers\.revember\]/g)).toHaveLength(1);

    configureMcpClient("codex", "disconnect", connection, paths);
    const disconnected = await fs.readFile(paths.codex, "utf8");
    expect(disconnected).toContain('model = "gpt-5"');
    expect(disconnected).toContain("[mcp_servers.github]");
    expect(disconnected).toContain("[features]");
    expect(disconnected).not.toContain("mcp_servers.revember");
  });

  it("preserves other Claude connections while adding and removing Revember", async () => {
    const paths = await configPaths();
    await fs.mkdir(path.dirname(paths.claude), { recursive: true });
    await fs.writeFile(paths.claude, JSON.stringify({
      mcpServers: {
        github: { command: "github-mcp", args: ["stdio"] }
      },
      unrelatedSetting: true
    }));

    configureMcpClient("claude", "connect", connection, paths);
    const configured = JSON.parse(await fs.readFile(paths.claude, "utf8"));
    expect(configured).toMatchObject({
      unrelatedSetting: true,
      mcpServers: {
        github: { command: "github-mcp", args: ["stdio"] },
        revember: {
          command: connection.runnerPath,
          args: []
        }
      }
    });

    configureMcpClient("claude", "disconnect", connection, paths);
    const disconnected = JSON.parse(await fs.readFile(paths.claude, "utf8"));
    expect(disconnected).toEqual({
      mcpServers: { github: { command: "github-mcp", args: ["stdio"] } },
      unrelatedSetting: true
    });
  });

  it("refuses to overwrite malformed Claude configuration", async () => {
    const paths = await configPaths();
    await fs.mkdir(path.dirname(paths.claude), { recursive: true });
    await fs.writeFile(paths.claude, "{not json");

    expect(() => configureMcpClient("claude", "connect", connection, paths)).toThrow();
    expect(await fs.readFile(paths.claude, "utf8")).toBe("{not json");
  });
});

async function configPaths(): Promise<McpClientConfigPaths> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-mcp-client-config-"));
  temporaryRoots.push(root);
  return {
    codex: path.join(root, ".codex", "config.toml"),
    claude: path.join(root, "Library", "Application Support", "Claude", "claude_desktop_config.json")
  };
}
