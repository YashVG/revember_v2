import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Write private text through a sibling file, so readers never see a partial write. */
export function writeTextAtomically(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function writeJsonAtomically(filePath: string, value: unknown): void {
  writeTextAtomically(filePath, JSON.stringify(value, null, 2) + "\n");
}

/** Reject paths outside a storage root, including sibling paths with a shared prefix. */
export function assertPathContained(parentPath: string, childPath: string, errorMessage: string): void {
  const relative = path.relative(parentPath, childPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(errorMessage);
}
