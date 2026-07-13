import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-electron-e2e-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
const progressPath = path.join(temporaryRoot, "progress.json");
await cp(path.join(root, "RevemberKnowledge"), knowledgeRoot, { recursive: true });

const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
    REVEMBER_PROGRESS_PATH: progressPath,
    REVEMBER_USER_DATA_PATH: path.join(temporaryRoot, "user-data")
  }
});

try {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("heading", { name: "Bluetooth Low Energy" }).waitFor();
  assert.equal(await window.getByText("Local JSON").isVisible(), true);

  await window.getByRole("button", { name: "Graph", exact: true }).click();
  await window.getByLabel("Knowledge relationships").waitFor();
  assert.match(await window.getByText(/nodes/).first().textContent(), /22 nodes/);

  await window.getByRole("button", { name: "Check-In", exact: true }).click();
  await window.getByText("At the lowest useful level, what is a bit?").waitFor();
  await window.getByRole("button", { name: /A distinguishable physical state/ }).click();
  await window.getByRole("button", { name: "Good", exact: true }).click();
  await window.getByRole("button", { name: "Save Review", exact: true }).click();
  await window.getByRole("button", { name: "Saved", exact: true }).waitFor();

  const progress = JSON.parse(await readFile(progressPath, "utf8"));
  assert.equal(progress.schemaVersion, 2);
  assert.equal(progress.reviewEvents.length, 1);
  assert.equal(progress.reviewEvents[0].questionID, "ble-q001");

  await window.getByTitle("Settings").click();
  await window.getByRole("heading", { name: "Revember Settings" }).waitFor();
  assert.equal(await window.getByText(progressPath).isVisible(), true);
  await window.screenshot({ path: path.join(temporaryRoot, "revember-electron.png"), fullPage: true });
  await window.locator(".settings-dialog header .icon-button").click();

  await window.getByTitle("Capture learning checkpoint").click();
  await window.getByPlaceholder(/Write one concrete thing/).fill("I can now distinguish the physical bit state from protocol meaning.");
  await window.getByPlaceholder("What still feels unresolved?").fill("How does the Link Layer frame the bytes?");
  await window.getByRole("button", { name: "Save Checkpoint", exact: true }).click();
  await window.getByRole("heading", { name: "Checkpoint saved" }).waitFor();
  const sessions = await readdir(path.join(knowledgeRoot, "sessions"));
  assert.equal(sessions.length, 1);
  console.log(`Electron E2E passed. Screenshot: ${path.join(temporaryRoot, "revember-electron.png")}`);
} finally {
  await app.close();
}
