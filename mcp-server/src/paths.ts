import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RevemberConfig } from "./config.js";

const SAFE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function assertSafeSlug(slug: string, label = "slug"): string {
  if (!SAFE_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid ${label} "${slug}". Use only letters, numbers, underscores, and hyphens; do not include path separators.`
    );
  }
  return slug;
}

export function safeResolve(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }

  throw new Error(`Refusing to access path outside configured root: ${resolvedTarget}`);
}

export function topicPath(config: RevemberConfig, slug: string): string {
  return safeResolve(config.topicsDir, `${assertSafeSlug(slug)}.json`);
}

export function markdownPath(config: RevemberConfig, slug: string): string {
  return safeResolve(config.notesDir, `${assertSafeSlug(slug)}.md`);
}

export function sessionPath(config: RevemberConfig, id: string): string {
  return safeResolve(config.sessionsDir, `${assertSafeSlug(id, "session id")}.json`);
}

export function backupPath(config: RevemberConfig, area: "topics" | "notes" | "sessions", sourcePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${path.basename(sourcePath)}.${timestamp}.${randomUUID()}.bak`;
  return safeResolve(config.backupsDir, area, fileName);
}

export async function ensureKnowledgeDirs(config: RevemberConfig): Promise<void> {
  safeResolve(config.knowledgeRoot);
  safeResolve(config.knowledgeRoot, "topics");
  safeResolve(config.knowledgeRoot, "notes");
  safeResolve(config.knowledgeRoot, "sessions");
  safeResolve(config.knowledgeRoot, ".backups", "topics");
  safeResolve(config.knowledgeRoot, ".backups", "notes");
  safeResolve(config.knowledgeRoot, ".backups", "sessions");
  await fs.mkdir(config.topicsDir, { recursive: true });
  await fs.mkdir(config.notesDir, { recursive: true });
  await fs.mkdir(config.sessionsDir, { recursive: true });
  await fs.mkdir(safeResolve(config.backupsDir, "topics"), { recursive: true });
  await fs.mkdir(safeResolve(config.backupsDir, "notes"), { recursive: true });
  await fs.mkdir(safeResolve(config.backupsDir, "sessions"), { recursive: true });
  await assertRealPathInside(config.knowledgeRoot, config.topicsDir);
  await assertRealPathInside(config.knowledgeRoot, config.notesDir);
  await assertRealPathInside(config.knowledgeRoot, config.sessionsDir);
  await assertRealPathInside(config.knowledgeRoot, config.backupsDir);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function backupIfExists(
  config: RevemberConfig,
  area: "topics" | "notes" | "sessions",
  sourcePath: string
): Promise<string | undefined> {
  if (!(await fileExists(sourcePath))) {
    return undefined;
  }

  const targetPath = backupPath(config, area, sourcePath);
  await assertRealPathInside(config.knowledgeRoot, sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await assertRealPathInside(config.knowledgeRoot, path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  return targetPath;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertRealPathInside(root: string, targetPath: string, allowMissing = false): Promise<void> {
  const rootRealPath = await fs.realpath(root);
  let targetRealPath: string;

  try {
    targetRealPath = await fs.realpath(targetPath);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    targetRealPath = await fs.realpath(path.dirname(targetPath));
  }

  if (!isInside(rootRealPath, targetRealPath)) {
    throw new Error(`Refusing to access real path outside configured knowledge root: ${targetPath}`);
  }
}

export async function safeReadFile(root: string, filePath: string): Promise<string> {
  await assertRealPathInside(root, filePath);
  return fs.readFile(filePath, "utf8");
}

export async function atomicWriteFile(root: string, filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await assertRealPathInside(root, path.dirname(filePath));
  if (await fileExists(filePath)) {
    await assertRealPathInside(root, filePath);
  }

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(tempPath, contents, { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
