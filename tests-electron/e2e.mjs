import assert from "node:assert/strict";
import { mkdir, mkdtemp, cp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
// A full Electron journey needs a deliberately supplied, already-authenticated
// test session. This never copies a session unless the caller opts in, and the
// copy lives only under the disposable E2E user-data directory.
if (process.env.REVEMBER_E2E_SESSION_PATH) {
  await mkdir(userDataPath, { recursive: true });
  await cp(process.env.REVEMBER_E2E_SESSION_PATH, path.join(userDataPath, "supabase-session.json"));
}

const launch = () => electron.launch({
  args: [root],
  env: {
    ...process.env,
    HOME: temporaryRoot,
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
  if (!process.env.REVEMBER_E2E_SESSION_PATH) {
    await window.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
    assert.equal(await window.getByLabel("Email", { exact: true }).isVisible(), true);
    assert.equal(await window.getByLabel("Password", { exact: true }).isVisible(), true);
    assert.equal(await window.getByRole("button", { name: "Sign in", exact: true }).isVisible(), true);
    assert.equal(await window.getByRole("button", { name: "Home", exact: true }).count(), 0);
    await window.getByRole("button", { name: "Need an account? Create one", exact: true }).click();
    await window.getByRole("heading", { name: "Create your account", exact: true }).waitFor();
    console.log("Electron auth-gate E2E passed.");
  } else {
  const accountTrigger = window.getByRole("button", { name: "Account menu", exact: true });
  await accountTrigger.waitFor();
  const authenticatedEmail = await window.evaluate(() => window.revember.getAuthState().then((state) => state.user?.email));
  assert.ok(authenticatedEmail, "the supplied E2E session must restore a signed-in user");
  await accountTrigger.click();
  const accountMenu = window.getByRole("menu", { name: "Account menu", exact: true });
  await accountMenu.getByText(authenticatedEmail, { exact: true }).waitFor();
  assert.equal(await accountMenu.getByRole("menuitem", { name: "Sign out", exact: true }).isVisible(), true);
  await accountTrigger.click();
  await window.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), true);
  await window.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  assert.equal(await window.locator(".workspace").evaluate((element) => element.classList.contains("sidebar-collapsed")), false);
  await window.getByTitle("Settings", { exact: true }).click();
  const settings = window.getByRole("dialog", { name: "Revember Settings", exact: true });
  await settings.getByText("AI study partner", { exact: true }).waitFor();
  assert.equal(await settings.getByRole("button", { name: "Connect Codex", exact: true }).isVisible(), true);
  assert.equal(await settings.getByRole("button", { name: "Connect Claude", exact: true }).isVisible(), true);
  await settings.getByRole("button", { name: "Connect Codex", exact: true }).click();
  await settings.getByText(/Codex is connected/).waitFor();
  const codexConfigPath = path.join(temporaryRoot, ".codex", "config.toml");
  assert.match(await readFile(codexConfigPath, "utf8"), /\[mcp_servers\.revember\]/);
  await settings.getByRole("button", { name: "Disconnect Codex", exact: true }).click();
  await settings.getByText(/Codex's Revember connection was removed/).waitFor();
  assert.doesNotMatch(await readFile(codexConfigPath, "utf8"), /mcp_servers\.revember/);
  await settings.getByRole("button", { name: "Close Revember Settings", exact: true }).click();
  await settings.waitFor({ state: "detached" });
  await window.getByRole("button", { name: "Questions", exact: true }).click();
  await window.getByRole("heading", { name: "Review", exact: true }).waitFor();
  await window.getByRole("button", { name: "Start review", exact: true }).waitFor();
  await window.getByRole("button", { name: "Home", exact: true }).click();
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await window.screenshot({ path: path.join(root, "work", "homepage-study-focus-e2e.png"), fullPage: true });
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });
  await window.locator(".home-topic-list").getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByText("Topic overview", { exact: true }).waitFor();
  assert.equal(await window.getByRole("button", { name: "Create AI note", exact: true }).count(), 0);
  await window.getByRole("button", { name: /^View notes\b/ }).click();
  await window.getByRole("complementary", { name: "Notes list", exact: true }).getByText("Bluetooth Low Energy", { exact: true }).waitFor();
  await window.getByRole("button", { name: "Home", exact: true }).click();
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await window.locator(".home-topic-list").getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByRole("button", { name: /^Manage questions\b/ }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  await window.getByRole("button", { name: "Review", exact: true }).first().click();
  await window.getByText("At the lowest useful level, what is a bit?").waitFor();
  await window.getByRole("button", { name: /A distinguishable physical state/ }).click();
  await window.getByText("Automatic difficulty", { exact: true }).waitFor();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();
  await window.getByRole("button", { name: "Reflect on this session", exact: true }).click();
  await window.getByPlaceholder(/Write one concrete thing/).fill("I can now distinguish the physical bit state from protocol meaning.");
  await window.getByPlaceholder("What still feels unresolved?").fill("How does the Link Layer frame the bytes?");
  await window.getByRole("button", { name: "Save reflection", exact: true }).click();
  await window.getByRole("heading", { name: "Reflection saved", exact: true }).waitFor();
  const sessions = await readdir(path.join(knowledgeRoot, "sessions"));
  assert.equal(sessions.length, 1);
  await window.getByRole("button", { name: "Done", exact: true }).click();

  const progress = JSON.parse(await readFile(progressPath, "utf8"));
  assert.equal(progress.schemaVersion, 2);
  assert.equal(progress.reviewEvents.length, 1);
  assert.equal(progress.reviewEvents[0].questionID, "ble-q001");

  await window.getByRole("button", { name: "Return to study focus", exact: true }).click();
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });

  await window.locator(".home-topic-list").getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByRole("button", { name: /^Manage questions\b/ }).click();
  await window.getByRole("heading", { name: "Questions", exact: true }).waitFor();
  await window.getByRole("button", { name: "New question", exact: true }).click();
  const cardEditor = window.getByRole("dialog", { name: "Create question", exact: true });
  await cardEditor.waitFor();
  await cardEditor.locator(".card-editor-question-field textarea").fill("An Electron E2E card uses a persistent local record.");
  await cardEditor.getByRole("textbox", { name: /^Answer/ }).fill("persistent local record");
  await cardEditor.getByLabel("Alternative 1", { exact: true }).fill("temporary remote cache");
  await cardEditor.getByLabel("Explanation", { exact: true }).fill("The card and its review evidence are stored locally for this isolated test.");
  await cardEditor.getByRole("button", { name: "Save question", exact: true }).click();
  await window.getByRole("status").filter({ hasText: /^Question saved/ }).waitFor();
  await window.locator(".cards-workspace").getByRole("button", { name: "Review", exact: true }).last().click();
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
  await window.locator(".home-topic-list").getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  const reloaded = await window.evaluate(() => window.revember.getSnapshot());
  assert.equal(reloaded.progress.reviewEvents.length, 2);
  assert.equal(reloaded.progress.topics.ble.reviewCardsByQuestionID[authoredEvent.questionID].dueAt, authoredSchedule.dueAt);
  await window.getByRole("button", { name: /^Manage questions\b/ }).click();
  await window.getByRole("heading", { name: "An Electron E2E card uses a ________.", exact: true }).waitFor();

  await window.getByTitle("Settings").click();
  const cloudSettings = window.getByRole("dialog", { name: "Revember Settings", exact: true });
  await cloudSettings.getByText("Cloud Vault", { exact: true }).waitFor();
  await cloudSettings.getByText(/Cloud revision \d+ saved/).waitFor();
  assert.equal(await cloudSettings.getByRole("button", { name: "Download cloud vault", exact: true }).isEnabled(), true);
  assert.equal(await window.getByText(progressPath).isVisible(), true);
  await window.screenshot({ path: path.join(temporaryRoot, "revember-electron.png"), fullPage: true });
  await window.locator(".settings-dialog header .icon-button").click();

  await window.getByRole("button", { name: "Notes", exact: true }).click();
  await window.getByRole("navigation", { name: "Notes topics", exact: true }).waitFor();
  await window.getByRole("navigation", { name: "Notes topics" }).getByRole("button", { name: /^Bluetooth Low Energy\b/ }).click();
  await window.getByRole("button", { name: "New note", exact: true }).click();
  await window.getByRole("dialog", { name: "New note", exact: true }).waitFor();
  const noteEditor = window.getByRole("dialog");
  const noteRawText = "  Leading and trailing spaces stay here  \n\nBluetooth Low Energy — café notes use hyphenated-text and repeated phrases.\nRepeated phrases remain repeated phrases.\n\tA tab begins this final line.  ";
  await noteEditor.getByRole("combobox", { name: /^Topic/ }).selectOption({ label: "Bluetooth Low Energy" });
  await noteEditor.getByLabel("Title", { exact: true }).fill("BLE exact-text note");
  await noteEditor.getByRole("textbox", { name: /^Raw text/ }).fill(noteRawText);
  await window.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
  try {
    await noteEditor.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor({ timeout: 5_000 });
  } catch {
    const saveState = await noteEditor.getByRole("status").textContent();
    const visibleError = await noteEditor.locator(".inline-error").textContent().catch(() => "none");
    assert.fail(`Keyboard save did not complete (state: ${saveState}; error: ${visibleError})`);
  }

  const captureDirectory = path.join(knowledgeRoot, "captures");
  const captureFiles = (await readdir(captureDirectory)).filter((name) => name.endsWith(".json"));
  assert.deepEqual(captureFiles.length, 1);
  const captureFile = (await Promise.all(captureFiles.map(async (fileName) => ({ fileName, capture: JSON.parse(await readFile(path.join(captureDirectory, fileName), "utf8")) })))).find(({ capture }) => capture.title === "BLE exact-text note");
  assert.ok(captureFile, "the explicitly authored note must be present");
  const capturePath = path.join(captureDirectory, captureFile.fileName);
  let savedCaptureBytes = await readFile(capturePath);
  let savedCapture = JSON.parse(savedCaptureBytes.toString("utf8"));
  assert.equal(savedCapture.title, "BLE exact-text note");
  assert.equal(savedCapture.topicID, "ble");
  assert.equal(savedCapture.rawText, noteRawText, "raw note text must be persisted exactly");
  assert.equal((await stat(capturePath)).mode & 0o777, 0o600, "private capture files must be owner-readable only");

  const captureSummaries = await window.evaluate(() => window.revember.listCaptureSummaries());
  assert.equal(captureSummaries.length, 1);
  const authoredSummary = captureSummaries.find((capture) => capture.title === "BLE exact-text note");
  assert.ok(authoredSummary);
  assert.equal(Object.hasOwn(authoredSummary, "rawText"), false, "capture summaries must not expose raw note text");
  const snapshotWithoutCaptures = await window.evaluate(() => window.revember.getSnapshot());
  assert.equal(Object.hasOwn(snapshotWithoutCaptures, "captures"), false, "the application snapshot must not include captures");

  await noteEditor.getByRole("button", { name: "Cancel", exact: true }).click();
  await window.getByRole("button", { name: "Finish lecture", exact: true }).click();
  await window.getByRole("button", { name: "Add a question", exact: true }).waitFor();
  savedCaptureBytes = await readFile(capturePath);
  savedCapture = JSON.parse(savedCaptureBytes.toString("utf8"));
  await window.getByRole("button", { name: "Create question from this section", exact: true }).click();
  await window.getByRole("dialog", { name: "Create question", exact: true }).waitFor();
  await window.locator(".card-editor-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await readFile(capturePath), savedCaptureBytes, "closing the question editor must not mutate the capture");

  await app.close();
  app = await launch();
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "Notes", exact: true }).click();
  await window.getByRole("navigation", { name: "Notes topics", exact: true }).waitFor();
  await window.getByRole("navigation", { name: "Notes topics" }).getByRole("button", { name: /^Bluetooth Low Energy\b/ }).click();
  await window.getByRole("button", { name: /BLE exact-text note/ }).click();
  await window.getByRole("button", { name: "Edit", exact: true }).click();
  const reopenedNoteEditor = window.getByRole("dialog", { name: "Edit note", exact: true });
  await reopenedNoteEditor.waitFor();
  assert.equal(await reopenedNoteEditor.getByLabel("Title", { exact: true }).inputValue(), "BLE exact-text note");
  assert.equal(await reopenedNoteEditor.getByRole("textbox", { name: /^Raw text/ }).inputValue(), noteRawText, "raw text must survive app relaunch unchanged");

  const externallyEditedCapture = {
    ...savedCapture,
    revision: savedCapture.revision + 1,
    rawText: "External writer preserved this newer copy.",
    updatedAt: new Date(Date.parse(savedCapture.updatedAt) + 1_000).toISOString()
  };
  await writeFile(capturePath, `${JSON.stringify(externallyEditedCapture, null, 2)}\n`, "utf8");
  const externalCaptureBytes = await readFile(capturePath);
  const localUnsavedRawText = `${noteRawText}\nLocal editor text must remain after the conflict.`;
  await reopenedNoteEditor.getByRole("textbox", { name: /^Raw text/ }).fill(localUnsavedRawText);
  await window.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
  await reopenedNoteEditor.getByRole("status").filter({ hasText: /^Conflict$/ }).waitFor();
  assert.equal(await reopenedNoteEditor.getByRole("textbox", { name: /^Raw text/ }).inputValue(), localUnsavedRawText, "a conflict must retain local unsaved note text");
  assert.deepEqual(await readFile(capturePath), externalCaptureBytes, "a conflict must not overwrite the external capture revision");
  const discardDialogPromise = window.waitForEvent("dialog");
  const cancelEditorPromise = reopenedNoteEditor.getByRole("button", { name: "Cancel", exact: true }).click();
  const discardDialog = await discardDialogPromise;
  assert.equal(discardDialog.type(), "confirm");
  assert.equal(discardDialog.message(), "Discard your unsaved note changes?");
  await discardDialog.accept();
  await cancelEditorPromise;
  await reopenedNoteEditor.waitFor({ state: "detached" });

  const downloaded = await window.evaluate(() => window.revember.downloadCloudVault());
  assert.ok(downloaded.sync.revision >= 1, "the authenticated account must return a cloud snapshot");
  assert.ok(downloaded.snapshot.topics.length > 0, "the downloaded cloud snapshot must load as a vault");
  const backups = await readdir(path.join(knowledgeRoot, ".revember-cloud-backups"));
  assert.ok(backups.length >= 1, "cloud download must preserve the isolated local vault first");
  await stat(path.join(knowledgeRoot, ".revember-cloud-backups", backups.at(-1), "captures", captureFile.fileName));
  console.log("Electron E2E passed.");
  }
} finally {
  try {
    await app.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
