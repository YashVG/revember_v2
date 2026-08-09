import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-document-lab-smoke-"));
const screenshotPath = path.join(root, "work", "document-lab-scaffold.png");
await mkdir(path.dirname(screenshotPath), { recursive: true });

const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    REVEMBER_USER_DATA_PATH: path.join(temporaryRoot, "user-data")
  }
});

try {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const labTab = window.locator(".sidebar").getByRole("button", { name: "Document Lab", exact: true });
  await labTab.waitFor();
  assert.equal(await labTab.count(), 1, "Document Lab should have one sidebar entry");
  assert.equal(await window.locator(".main-stage").getByRole("heading", { name: "Document Lab", exact: true }).count(), 0);

  await labTab.click();
  await window.getByRole("heading", { name: "Document Lab", exact: true }).waitFor();
  await window.getByText("Session only.", { exact: true }).waitFor();
  await window.getByRole("heading", { name: "Add a file", exact: true }).waitFor();
  assert.equal(await window.evaluate(() => typeof window.revember.generateDocumentLabNotes), "function");
  assert.equal(await window.getByRole("button", { name: /Create note/i }).count(), 0);
  assert.equal(await window.getByRole("button", { name: /Save/i }).count(), 0);

  await window.screenshot({ path: screenshotPath, fullPage: true });

  await window.getByRole("button", { name: "Home", exact: true }).click();
  assert.equal(await window.getByRole("heading", { name: "Document Lab", exact: true }).count(), 0);
} finally {
  await app.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`Document Lab sidebar smoke passed. Screenshot: ${screenshotPath}`);
