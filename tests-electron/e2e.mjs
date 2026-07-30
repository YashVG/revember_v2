import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-electron-e2e-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
const progressPath = path.join(temporaryRoot, "progress.json");
const userDataPath = path.join(temporaryRoot, "user-data");
await cp(path.join(root, "RevemberKnowledge"), knowledgeRoot, { recursive: true });

const launch = () => electron.launch({
  args: [root],
  env: {
    ...process.env,
    TZ: "UTC",
    REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
    REVEMBER_PROGRESS_PATH: progressPath,
    REVEMBER_USER_DATA_PATH: userDataPath
  }
});

let app = await launch();

try {
  let window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), true);
  await window.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), false);
  await window.getByRole("button", { name: "Questions", exact: true }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  await window.getByRole("button", { name: /Review due now/ }).waitFor();
  assert.equal(await window.getByRole("button", { name: "Notes", exact: true }).count(), 0);
  await window.getByRole("button", { name: "Home", exact: true }).click();
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });
  await window.getByRole("button", { name: "Topics", exact: true }).click();
  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByText("Topic overview", { exact: true }).waitFor();
  assert.equal(await window.getByRole("button", { name: "View notes", exact: true }).count(), 0);
  assert.equal(await window.getByRole("button", { name: "Create AI note", exact: true }).count(), 0);
  assert.equal(await window.getByText("Concepts", { exact: true }).count(), 0);
  await window.getByRole("button", { name: "Manage questions", exact: true }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  await window.getByRole("button", { name: "Review question", exact: true }).first().click();
  await window.getByText("At the lowest useful level, what is a bit?").waitFor();
  await window.getByRole("button", { name: /A distinguishable physical state/ }).click();
  await window.getByText("Automatic difficulty", { exact: true }).waitFor();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();

  const progress = JSON.parse(await readFile(progressPath, "utf8"));
  assert.equal(progress.schemaVersion, 2);
  assert.equal(progress.reviewEvents.length, 1);
  assert.equal(progress.reviewEvents[0].questionID, "ble-q001");

  await window.getByRole("button", { name: "Home", exact: true }).click();
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });

  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByRole("button", { name: "Manage questions", exact: true }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  await window.getByRole("button", { name: "New question", exact: true }).click();
  const cardEditor = window.getByRole("dialog", { name: "Create question", exact: true });
  await cardEditor.waitFor();
  await cardEditor.getByLabel("Sentence containing the answer", { exact: true }).fill("An Electron E2E card uses a persistent local record.");
  await cardEditor.getByRole("textbox", { name: /^Answer/ }).fill("persistent local record");
  await cardEditor.getByLabel("Alternative 1", { exact: true }).fill("temporary remote cache");
  await cardEditor.getByLabel("Explanation", { exact: true }).fill("The card and its review evidence are stored locally for this isolated test.");
  await cardEditor.getByRole("button", { name: "Save question", exact: true }).click();
  await cardEditor.getByRole("heading", { name: "Question saved", exact: true }).waitFor();
  await cardEditor.getByRole("button", { name: "Review question", exact: true }).click();
  await window.getByRole("heading", { name: "An Electron E2E card uses a ________.", exact: true }).waitFor();
  await window.getByRole("button", { name: /persistent local record/ }).click();
  await window.getByText("Automatic difficulty", { exact: true }).waitFor();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();
  assert.equal(await window.getByText("Earliest next review", { exact: true }).isVisible(), true);

  const afterAuthoredReview = JSON.parse(await readFile(progressPath, "utf8"));
  const authoredEvent = afterAuthoredReview.reviewEvents.find((event) => event.questionID !== "ble-q001");
  assert.ok(authoredEvent, "the authored card must create review evidence");
  assert.equal(authoredEvent.isCorrect, true);
  assert.ok(["hard", "good", "easy"].includes(authoredEvent.rating));
  assert.equal(authoredEvent.ratingSource, "responseTime");
  assert.ok(Number.isInteger(authoredEvent.responseTimeMs));
  assert.ok(authoredEvent.responseTimeMs >= 0 && authoredEvent.responseTimeMs <= 60_000);
  const authoredSchedule = afterAuthoredReview.topics.ble.reviewCardsByQuestionID[authoredEvent.questionID];
  assert.ok(authoredSchedule);
  assert.equal(authoredSchedule.lastRating, authoredEvent.rating);
  assert.ok(new Date(authoredSchedule.dueAt).getTime() > new Date(authoredEvent.reviewedAt).getTime());

  await app.close();
  app = await launch();
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "Topics", exact: true }).click();
  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  const reloaded = await window.evaluate(() => window.revember.getSnapshot());
  assert.equal(reloaded.progress.reviewEvents.length, 2);
  assert.equal(reloaded.progress.topics.ble.reviewCardsByQuestionID[authoredEvent.questionID].dueAt, authoredSchedule.dueAt);
  await window.getByRole("button", { name: "Manage questions", exact: true }).click();
  await window.getByRole("heading", { name: "An Electron E2E card uses a ________.", exact: true }).waitFor();

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
  await window.getByRole("button", { name: "Done", exact: true }).click();
  console.log("Electron E2E passed.");
} finally {
  try {
    await app.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
