import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-local-ai-e2e-"));
const knowledgeRoot = path.join(temporaryRoot, "RevemberKnowledge");
const progressPath = path.join(temporaryRoot, "progress.json");
const userDataPath = path.join(temporaryRoot, "user-data");
const rawText = [
  "  A deterministic local model keeps the original lecture note private.",
  "Grounded takeaways quote exact source lines instead of inventing facts.",
  "Finishing a lecture starts analysis only after the draft is safely saved.  "
].join("\n");
const expectedEvidence = [
  "A deterministic local model keeps the original lecture note private.",
  "Grounded takeaways quote exact source lines instead of inventing facts.",
  "Finishing a lecture starts analysis only after the draft is safely saved."
];

await cp(path.join(root, "RevemberKnowledge"), knowledgeRoot, { recursive: true });

let requestCount = 0;
let serverError;
const server = createServer((request, response) => {
  void handleOllamaRequest(request, response).catch((error) => {
    serverError = error;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const ollamaURL = `http://127.0.0.1:${address.port}/api/generate`;

let app;
try {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      TZ: "UTC",
      REVEMBER_KNOWLEDGE_ROOT: knowledgeRoot,
      REVEMBER_PROGRESS_PATH: progressPath,
      REVEMBER_USER_DATA_PATH: userDataPath,
      REVEMBER_OLLAMA_URL: ollamaURL
    }
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  const lectureNote = window.getByRole("textbox", { name: "Lecture note", exact: true });
  await lectureNote.fill(rawText);
  await window.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor();
  await window.getByRole("button", { name: "Finish lecture", exact: true }).click();
  await window.getByRole("button", { name: "Lecture finished", exact: true }).waitFor();
  await window.getByRole("button", { name: /Open notes/ }).click();
  await window.getByRole("heading", { name: "Notes", exact: true }).waitFor();
  await window.getByText(/^Ready · Revision \d+$/).waitFor();

  const localResponse = window.locator(".note-enrichment");
  await localResponse.getByText("Local study response", { exact: true }).waitFor();
  await localResponse.locator(".note-enrichment-result").waitFor({ timeout: 15_000 });
  assert.deepEqual(
    await localResponse.locator("q").allTextContents(),
    expectedEvidence,
    "the rendered local response must quote exact note source lines"
  );

  assert.equal(serverError, undefined, "the fake Ollama server must accept the app request");
  assert.equal(requestCount, 1, "finishing one lecture must make exactly one local-model request");

  const captureFiles = (await readdir(path.join(knowledgeRoot, "captures")))
    .filter((name) => name.endsWith(".json"));
  assert.equal(captureFiles.length, 1);
  const capture = JSON.parse(await readFile(path.join(knowledgeRoot, "captures", captureFiles[0]), "utf8"));
  assert.equal(capture.status, "ready");
  assert.equal(capture.rawText, rawText, "finishing and enrichment must not alter raw note text");

  const enrichmentFiles = (await readdir(path.join(knowledgeRoot, "capture-enrichments")))
    .filter((name) => name.endsWith(".json"));
  assert.equal(enrichmentFiles.length, 1);
  const enrichment = JSON.parse(
    await readFile(path.join(knowledgeRoot, "capture-enrichments", enrichmentFiles[0]), "utf8")
  );
  assert.equal(enrichment.captureID, capture.id);
  assert.equal(enrichment.captureRevision, capture.revision);
  assert.equal(enrichment.status, "ready");
  assert.deepEqual(
    enrichment.result.takeaways.map((takeaway) => takeaway.evidence),
    expectedEvidence,
    "persisted enrichment evidence must reference exact source lines"
  );

  console.log("Local AI Electron E2E passed.");
} finally {
  try {
    await app?.close();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function handleOllamaRequest(request, response) {
  requestCount += 1;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/generate");
  assert.equal(request.headers["content-type"], "application/json");

  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  assert.equal(payload.model, "llama3");
  assert.equal(payload.stream, false);
  const prompt = JSON.parse(payload.prompt);
  assert.deepEqual(
    prompt.sourceSegments.map((segment) => segment.text),
    expectedEvidence,
    "the main process must send exact trimmed source segments to Ollama"
  );

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    response: JSON.stringify({
      takeaways: prompt.sourceSegments.map((segment) => ({ evidenceID: segment.id }))
    })
  }));
}
