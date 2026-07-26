import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  const lectureNote = window.getByRole("textbox", { name: "Lecture note", exact: true });
  await lectureNote.waitFor();
  await lectureNote.fill("A quick note from the homepage must stay local.");
  await window.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor();
  const homepageCaptureFiles = (await readdir(path.join(knowledgeRoot, "captures"))).filter((name) => name.endsWith(".json"));
  assert.equal(homepageCaptureFiles.length, 1, "the lecture note pad must save a local draft automatically");
  const homepageCapture = JSON.parse(await readFile(path.join(knowledgeRoot, "captures", homepageCaptureFiles[0]), "utf8"));
  assert.equal(homepageCapture.rawText, "A quick note from the homepage must stay local.");
  await window.screenshot({ path: path.join(root, "work", "homepage-note-saved-e2e.png"), fullPage: true });
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });
  await window.getByRole("button", { name: "Topics", exact: true }).click();
  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  assert.equal(await window.getByText("Local JSON").isVisible(), true);

  await window.getByRole("button", { name: "Graph", exact: true }).click();
  await window.getByRole("group", { name: "Knowledge relationships", exact: true }).waitFor();
  assert.match(await window.getByText(/nodes/).first().textContent(), /22 nodes/);

  const graph = window.getByRole("group", { name: "Knowledge relationships", exact: true });
  const graphNodes = graph.locator(".graph-node");
  assert.equal(await graphNodes.count(), 22);
  assert.match(await graphNodes.first().getAttribute("aria-label"), /Concept:/);

  const graphGroup = graph.locator(":scope > g").last();
  const graphHandle = await graph.elementHandle();
  const graphGroupHandle = await graphGroup.elementHandle();
  assert.ok(graphHandle);
  assert.ok(graphGroupHandle);
  const waitForGraphTransformChange = (previousTransform) => window.waitForFunction(
    ([element, previous]) => element.getAttribute("transform") !== previous,
    [graphGroupHandle, previousTransform]
  );
  const waitForGraphTransform = (expectedTransform) => window.waitForFunction(
    ([element, expected]) => element.getAttribute("transform") === expected,
    [graphGroupHandle, expectedTransform]
  );
  const initialTransform = await graphGroup.getAttribute("transform");
  await window.getByRole("button", { name: "Zoom in" }).click();
  await waitForGraphTransformChange(initialTransform);
  assert.notEqual(await graphGroup.getAttribute("transform"), initialTransform);
  await window.getByRole("button", { name: "Reset graph view" }).click();
  await waitForGraphTransform("translate(0 0) scale(1)");
  assert.equal(await graphGroup.getAttribute("transform"), "translate(0 0) scale(1)");

  await window.getByRole("button", { name: "Fit graph to view" }).click();
  await window.getByRole("button", { name: "Zoom in" }).click();
  await window.getByRole("button", { name: "Zoom in" }).click();
  await graph.focus();
  const beforeArrowPan = await graphGroup.getAttribute("transform");
  await window.keyboard.press("ArrowRight");
  await waitForGraphTransformChange(beforeArrowPan);
  assert.notEqual(await graphGroup.getAttribute("transform"), beforeArrowPan);
  const beforeKeyboardZoom = await graphGroup.getAttribute("transform");
  await window.keyboard.press("+");
  await waitForGraphTransformChange(beforeKeyboardZoom);
  assert.notEqual(await graphGroup.getAttribute("transform"), beforeKeyboardZoom);

  const graphBox = await graph.boundingBox();
  assert.ok(graphBox);
  const scrollBefore = await window.locator(".main-stage").evaluate((element) => element.scrollTop);
  const beforeWheelZoom = await graphGroup.getAttribute("transform");
  await graph.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: graphBox.x + graphBox.width / 2,
    clientY: graphBox.y + graphBox.height / 4,
    deltaY: -180
  });
  await waitForGraphTransformChange(beforeWheelZoom);
  assert.notEqual(await graphGroup.getAttribute("transform"), beforeWheelZoom);
  assert.equal(await window.locator(".main-stage").evaluate((element) => element.scrollTop), scrollBefore);

  await window.getByRole("button", { name: "Fit graph to view" }).click();
  await window.getByRole("button", { name: "Zoom in" }).click();
  await window.getByRole("button", { name: "Zoom in" }).click();
  const beforeDrag = await graphGroup.getAttribute("transform");
  const dragStart = await graph.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (let y = 20; y <= bounds.height - 40; y += 30) {
      for (let x = 20; x <= bounds.width - 110; x += 30) {
        const target = document.elementFromPoint(bounds.left + x, bounds.top + y);
        if (target && element.contains(target) && !target.closest(".graph-node")) return { x, y };
      }
    }
    throw new Error("No unobstructed graph background point is available for panning");
  });
  await graph.dragTo(graph, {
    sourcePosition: dragStart,
    targetPosition: { x: dragStart.x + 90, y: dragStart.y + 20 }
  });
  await waitForGraphTransformChange(beforeDrag);
  assert.notEqual(await graphGroup.getAttribute("transform"), beforeDrag);

  const conceptFilter = window.locator(".graph-controls button").nth(0);
  const conceptFilterHandle = await conceptFilter.elementHandle();
  assert.ok(conceptFilterHandle);
  assert.equal(await conceptFilter.getAttribute("aria-pressed"), "true");
  await conceptFilter.click();
  await window.waitForFunction(
    ([filter, canvas]) => filter.getAttribute("aria-pressed") === "false"
      && canvas.querySelectorAll(".graph-node").length === 13,
    [conceptFilterHandle, graphHandle]
  );
  assert.equal(await conceptFilter.getAttribute("aria-pressed"), "false");
  assert.equal(await graphNodes.count(), 13);
  await conceptFilter.click();
  await window.waitForFunction(
    ([filter, canvas]) => filter.getAttribute("aria-pressed") === "true"
      && canvas.querySelectorAll(".graph-node").length === 22,
    [conceptFilterHandle, graphHandle]
  );
  assert.equal(await graphNodes.count(), 22);

  await graphNodes.first().hover();
  await window.waitForFunction(
    (canvas) => canvas.querySelector(".graph-node.dimmed") !== null,
    graphHandle
  );
  assert.ok(await graph.locator(".graph-node.dimmed").count() > 0);
  await graphNodes.nth(1).focus();
  await window.keyboard.press("Enter");
  assert.equal(await window.getByRole("heading", { name: "Bytes", exact: true }).isVisible(), true);

  await window.getByRole("button", { name: /Operating Systems and Computer Architecture/ }).click();
  await window.getByRole("heading", { name: "Operating Systems and Computer Architecture", exact: true }).waitFor();
  await window.getByText(/20 nodes/).waitFor();
  assert.equal(await graphNodes.count(), 20);
  assert.match(await graphNodes.first().getAttribute("aria-label"), /Concept:|Gap:|Check:/);

  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByText(/22 nodes/).waitFor();
  assert.equal(await graphNodes.count(), 22);

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

  await window.getByRole("button", { name: "Home", exact: true }).click();
  await window.getByRole("heading", { name: "Study focus", exact: true }).waitFor();
  await window.screenshot({ path: path.join(root, "work", "homepage-e2e.png"), fullPage: true });

  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByRole("button", { name: "Cards", exact: true }).click();
  await window.getByRole("heading", { name: "Cards", exact: true }).waitFor();
  await window.getByRole("button", { name: "New Card", exact: true }).click();
  const cardEditor = window.getByRole("dialog", { name: "Create card", exact: true });
  await cardEditor.waitFor();
  await cardEditor.getByLabel("Sentence containing the answer", { exact: true }).fill("An Electron E2E card uses a persistent local record.");
  await cardEditor.getByRole("textbox", { name: /^Answer/ }).fill("persistent local record");
  await cardEditor.getByLabel("Alternative 1", { exact: true }).fill("temporary remote cache");
  await cardEditor.getByLabel("Explanation", { exact: true }).fill("The card and its review evidence are stored locally for this isolated test.");
  await cardEditor.getByRole("button", { name: "Save card", exact: true }).click();
  await cardEditor.getByRole("heading", { name: "Card saved", exact: true }).waitFor();
  await cardEditor.getByRole("button", { name: "Review this card", exact: true }).click();
  await window.getByRole("heading", { name: "An Electron E2E card uses a ________.", exact: true }).waitFor();
  await window.getByRole("button", { name: /persistent local record/ }).click();
  await window.getByRole("button", { name: "Good", exact: true }).click();
  await window.getByRole("button", { name: "Finish Review", exact: true }).click();
  await window.getByRole("heading", { name: "Review complete", exact: true }).waitFor();
  assert.equal(await window.getByText("Earliest next review", { exact: true }).isVisible(), true);

  const afterAuthoredReview = JSON.parse(await readFile(progressPath, "utf8"));
  const authoredEvent = afterAuthoredReview.reviewEvents.find((event) => event.questionID !== "ble-q001");
  assert.ok(authoredEvent, "the authored card must create review evidence");
  assert.equal(authoredEvent.isCorrect, true);
  assert.equal(authoredEvent.rating, "good");
  const authoredSchedule = afterAuthoredReview.topics.ble.reviewCardsByQuestionID[authoredEvent.questionID];
  assert.ok(authoredSchedule);
  assert.equal(authoredSchedule.lastRating, "good");
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
  await window.getByRole("button", { name: "Cards", exact: true }).click();
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

  await window.getByRole("button", { name: "Notes", exact: true }).click();
  await window.getByRole("heading", { name: "Notes", exact: true }).waitFor();
  await window.getByRole("button", { name: "New note", exact: true }).click();
  await window.getByRole("dialog", { name: "New note", exact: true }).waitFor();
  const noteEditor = window.getByRole("dialog");
  const noteRawText = "  Leading and trailing spaces stay here  \n\nBluetooth Low Energy — café notes use hyphenated-text and repeated phrases.\nRepeated phrases remain repeated phrases.\n\tA tab begins this final line.  ";
  const concisePoint = "Bluetooth Low Energy uses short-range radio communication.";
  await noteEditor.getByRole("combobox", { name: /^Topic/ }).selectOption({ label: "Bluetooth Low Energy" });
  await noteEditor.getByLabel("Title", { exact: true }).fill("BLE exact-text note");
  await noteEditor.getByRole("textbox", { name: /^Raw text/ }).fill(noteRawText);
  await noteEditor.getByRole("button", { name: "Add point", exact: true }).click();
  await noteEditor.getByLabel("Concise point 1", { exact: true }).fill(concisePoint);
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
  assert.deepEqual(captureFiles.length, 2);
  const captureFile = (await Promise.all(captureFiles.map(async (fileName) => ({ fileName, capture: JSON.parse(await readFile(path.join(captureDirectory, fileName), "utf8")) })))).find(({ capture }) => capture.title === "BLE exact-text note");
  assert.ok(captureFile, "the explicitly authored note must be present alongside the homepage draft");
  const capturePath = path.join(captureDirectory, captureFile.fileName);
  const savedCaptureBytes = await readFile(capturePath);
  const savedCapture = JSON.parse(savedCaptureBytes.toString("utf8"));
  assert.equal(savedCapture.title, "BLE exact-text note");
  assert.equal(savedCapture.topicID, "ble");
  assert.equal(savedCapture.rawText, noteRawText, "raw note text must be persisted exactly");
  assert.equal(savedCapture.concisePoints.length, 1);
  assert.equal(savedCapture.concisePoints[0].text, concisePoint);
  assert.match(savedCapture.concisePoints[0].id, /^point-[0-9a-f-]+$/i, "the main process must assign the concise-point ID");
  assert.equal((await stat(capturePath)).mode & 0o777, 0o600, "private capture files must be owner-readable only");

  const captureSummaries = await window.evaluate(() => window.revember.listCaptureSummaries());
  assert.equal(captureSummaries.length, 2);
  const authoredSummary = captureSummaries.find((capture) => capture.title === "BLE exact-text note");
  assert.ok(authoredSummary);
  assert.equal(Object.hasOwn(authoredSummary, "rawText"), false, "capture summaries must not expose raw note text");
  assert.equal(JSON.stringify(authoredSummary).includes(concisePoint), false, "capture summaries must not expose concise-point text");
  const snapshotWithoutCaptures = await window.evaluate(() => window.revember.getSnapshot());
  assert.equal(Object.hasOwn(snapshotWithoutCaptures, "captures"), false, "the application snapshot must not include captures");

  await noteEditor.getByRole("button", { name: "Create card", exact: true }).click();
  await window.getByRole("dialog", { name: "Create card", exact: true }).waitFor();
  const pointCardEditor = window.locator(".card-editor-dialog");
  assert.equal(await pointCardEditor.getByRole("textbox", { name: "Sentence containing the answer", exact: true }).inputValue(), concisePoint);
  await pointCardEditor.getByRole("button", { name: "Cancel", exact: true }).click();
  await pointCardEditor.waitFor({ state: "detached" });
  assert.deepEqual(await readFile(capturePath), savedCaptureBytes, "opening and cancelling a point-derived card must not mutate the capture");

  await app.close();
  app = await launch();
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "Topics", exact: true }).click();
  await window.getByRole("button", { name: /Bluetooth Low Energy/ }).click();
  await window.getByRole("heading", { name: "Bluetooth Low Energy", exact: true }).waitFor();
  await window.getByRole("button", { name: "Notes", exact: true }).click();
  await window.getByRole("heading", { name: "Notes", exact: true }).waitFor();
  await window.getByRole("button", { name: /BLE exact-text note/ }).click();
  await window.getByRole("button", { name: "Edit", exact: true }).click();
  const reopenedNoteEditor = window.getByRole("dialog", { name: "Edit note", exact: true });
  await reopenedNoteEditor.waitFor();
  assert.equal(await reopenedNoteEditor.getByLabel("Title", { exact: true }).inputValue(), "BLE exact-text note");
  assert.equal(await reopenedNoteEditor.getByRole("textbox", { name: /^Raw text/ }).inputValue(), noteRawText, "raw text must survive app relaunch unchanged");
  assert.equal(await reopenedNoteEditor.getByLabel("Concise point 1", { exact: true }).inputValue(), concisePoint);

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
  console.log("Electron E2E passed.");
} finally {
  try {
    await app.close();
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
