import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RevemberConfig {
  packageRoot: string;
  knowledgeRoot: string;
  topicsDir: string;
  notesDir: string;
  backupsDir: string;
  progressPath: string;
}

function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

function findPackageRoot(startDirectory: string): string {
  let current = path.resolve(startDirectory);

  while (true) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDirectory, "..");
    }
    current = parent;
  }
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(moduleDirectory);

export function defaultKnowledgeRoot(): string {
  return path.resolve(packageRoot, "..", "..", "RevemberKnowledge");
}

export function defaultProgressPath(): string {
  return path.join(homedir(), "Library", "Application Support", "RevemberV2", "progress.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RevemberConfig {
  const knowledgeRoot = path.resolve(expandHome(env.REVEMBER_KNOWLEDGE_ROOT ?? defaultKnowledgeRoot()));
  const progressPath = path.resolve(expandHome(env.REVEMBER_PROGRESS_PATH ?? defaultProgressPath()));

  return {
    packageRoot,
    knowledgeRoot,
    topicsDir: path.join(knowledgeRoot, "topics"),
    notesDir: path.join(knowledgeRoot, "notes"),
    backupsDir: path.join(knowledgeRoot, ".backups"),
    progressPath
  };
}
