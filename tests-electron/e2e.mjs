import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    TZ: "UTC",
    REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
    REVEMBER_PROGRESS_PATH: progressPath,
    REVEMBER_USER_DATA_PATH: userDataPath
  }
});

try {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await window.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), true);
  await window.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), false);

  await window.getByTitle("Settings", { exact: true }).click();
  const settings = window.getByRole("dialog", { name: "Revember Settings", exact: true });
  await settings.getByText("AI study partner", { exact: true }).waitFor();
  assert.equal(await settings.getByRole("button", { name: "Connect Codex", exact: true }).isVisible(), true);
  assert.equal(await settings.getByRole("button", { name: "Connect Claude", exact: true }).isVisible(), true);
  await settings.getByRole("button", { name: "Close Revember Settings", exact: true }).click();

  await window.getByRole("button", { name: "Questions", exact: true }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  const queueStart = window.locator(".questions-review-start");
  await queueStart.waitFor();
  await queueStart.click();
  await window.getByRole("button", { name: "Return to Question Library", exact: true }).waitFor();
  await window.getByRole("button", { name: "Return to Question Library", exact: true }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();

  const firstTopic = window.locator(".question-topic-row").first();
  await firstTopic.getByRole("button", { name: /^Review \d+ ready$/ }).click();
  await window.getByRole("button", { name: "Return to Question Library", exact: true }).click();
  await firstTopic.getByRole("button", { name: "View set", exact: true }).click();
  const firstQuestion = window.locator(".authored-card").first();
  await firstQuestion.getByRole("button", { name: "Practice", exact: true }).click();
  await window.getByRole("heading", { name: "At the lowest useful level, what is a bit?", exact: true }).waitFor();
  await window.getByRole("button", { name: /A distinguishable physical state/ }).click();
  await window.getByText("Automatic difficulty", { exact: true }).waitFor();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();
  await window.getByRole("button", { name: "Return to Bluetooth Low Energy", exact: true }).click();
  await window.locator(".cards-workspace").getByRole("heading", { name: "Questions", exact: true }).waitFor();

  const progressAfterPractice = JSON.parse(await readFile(progressPath, "utf8"));
  assert.equal(progressAfterPractice.schemaVersion, 2);
  assert.equal(progressAfterPractice.reviewEvents.length, 1);
  assert.equal(progressAfterPractice.reviewEvents[0].questionID, "ble-q001");

  await window.getByRole("button", { name: "New question", exact: true }).click();
  const cardEditor = window.getByRole("dialog", { name: "Create question", exact: true });
  await cardEditor.waitFor();
  await cardEditor.getByRole("radio", { name: /Direct question/ }).click();
  await cardEditor.locator(".card-editor-question-field textarea").fill("Which local record stores recall attempts?");
  await cardEditor.locator(".card-editor-answer-panel input").fill("review history");
  await cardEditor.getByLabel("Alternative 1", { exact: true }).fill("remote cache");
  await cardEditor.getByLabel("Explanation", { exact: true }).fill("Revember stores review events in the local progress record.");
  await cardEditor.getByRole("button", { name: "Save question", exact: true }).click();
  await window.getByRole("status").filter({ hasText: /^Question saved/ }).waitFor();

  const authoredCard = window.locator(".authored-card").filter({ hasText: "Which local record stores recall attempts?" });
  await authoredCard.getByRole("button", { name: "Practice", exact: true }).click();
  await window.getByRole("heading", { name: "Which local record stores recall attempts?", exact: true }).waitFor();
  await window.getByRole("button", { name: /review history/ }).click();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();
  assert.equal(await window.getByText("Earliest next review", { exact: true }).isVisible(), true);
  await window.getByRole("button", { name: "Return to Bluetooth Low Energy", exact: true }).click();
  await window.getByRole("heading", { name: "Which local record stores recall attempts?", exact: true }).waitFor();

  const progressAfterAuthoring = JSON.parse(await readFile(progressPath, "utf8"));
  assert.equal(progressAfterAuthoring.reviewEvents.length, 2);
  const authoredEvent = progressAfterAuthoring.reviewEvents.find((event) => event.questionID !== "ble-q001");
  assert.ok(authoredEvent, "the authored question must create review evidence");
  assert.equal(authoredEvent.isCorrect, true);
  assert.ok(["hard", "good", "easy"].includes(authoredEvent.rating));

  console.log("Electron E2E passed.");
} finally {
  try {
    await app.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
