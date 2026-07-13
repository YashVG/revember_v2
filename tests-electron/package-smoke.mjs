import assert from "node:assert/strict";
import { access, cp, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, "release", "mac-arm64", "Revember.app", "Contents", "MacOS", "Revember"),
  path.join(root, "release", "mac", "Revember.app", "Contents", "MacOS", "Revember"),
  path.join(root, "release", "mac-x64", "Revember.app", "Contents", "MacOS", "Revember")
];
let executablePath;
for (const candidate of candidates) {
  try { await access(candidate, constants.X_OK); executablePath = candidate; break; } catch {}
}
assert.ok(executablePath, "A packaged Revember executable was not found under release/.");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-package-smoke-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
await cp(path.join(root, "RevemberKnowledge"), knowledgeRoot, { recursive: true });

const packagedApp = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
    REVEMBER_PROGRESS_PATH: path.join(temporaryRoot, "progress.json"),
    REVEMBER_USER_DATA_PATH: path.join(temporaryRoot, "user-data")
  }
});

try {
  const metadata = await packagedApp.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion()
  }));
  assert.deepEqual(metadata, { isPackaged: true, name: "Revember", version: "0.2.0" });
  const window = await packagedApp.firstWindow();
  await window.getByRole("heading", { name: "Bluetooth Low Energy" }).waitFor();
  assert.equal(await window.getByText("Fundamentals cockpit").isVisible(), true);
  console.log(`Packaged Electron smoke passed: ${executablePath}`);
} finally {
  await packagedApp.close();
}
