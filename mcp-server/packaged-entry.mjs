import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const home = homedir();
const fallbackKnowledgeRoot = path.join(home, "Documents", "RevemberKnowledge");
const fallbackProgressPath = path.join(home, "Library", "Application Support", "RevemberV2", "progress.json");
const settingsPath = path.join(home, "Library", "Application Support", "Revember", "settings.json");

if (!process.env.REVEMBER_KNOWLEDGE_ROOT || !process.env.REVEMBER_PROGRESS_PATH) {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      const value = settings;
      if (!process.env.REVEMBER_KNOWLEDGE_ROOT && typeof value.knowledgeRootPath === "string" && value.knowledgeRootPath.trim()) {
        process.env.REVEMBER_KNOWLEDGE_ROOT = value.knowledgeRootPath;
      }
      if (!process.env.REVEMBER_PROGRESS_PATH && typeof value.progressPath === "string" && value.progressPath.trim()) {
        process.env.REVEMBER_PROGRESS_PATH = value.progressPath;
      }
    }
  } catch (error) {
    if (existsSync(settingsPath)) {
      console.error(`Revember MCP could not read the app settings: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}

process.env.REVEMBER_KNOWLEDGE_ROOT ??= fallbackKnowledgeRoot;
process.env.REVEMBER_PROGRESS_PATH ??= fallbackProgressPath;

await import("./dist/index.js");
