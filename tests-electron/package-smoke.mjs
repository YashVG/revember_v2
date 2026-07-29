import assert from "node:assert/strict";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = process.env.REVEMBER_APP_BUNDLE
  ? path.resolve(process.env.REVEMBER_APP_BUNDLE)
  : path.join(root, "release", process.arch === "arm64" ? "mac-arm64" : "mac", "Revember.app");
const executablePath = path.join(appBundle, "Contents", "MacOS", "Revember");
await access(executablePath, constants.X_OK);

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-package-smoke-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
let packagedApp;

try {
  await cp(path.join(root, "RevemberKnowledge"), knowledgeRoot, { recursive: true });
  packagedApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
      REVEMBER_PROGRESS_PATH: path.join(temporaryRoot, "progress.json"),
      REVEMBER_USER_DATA_PATH: path.join(temporaryRoot, "user-data")
    }
  });
  const metadata = await packagedApp.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion()
  }));
  assert.deepEqual(metadata, { isPackaged: true, name: "Revember", version: "0.2.0" });
  const window = await packagedApp.firstWindow();
  await window.getByRole("button", { name: "Topics", exact: true }).click();
  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  assert.equal(await window.getByText("Topic overview").isVisible(), true);
  console.log(`Packaged Electron smoke passed: ${executablePath}`);
} finally {
  try {
    await packagedApp?.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
