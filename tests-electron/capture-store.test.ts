import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { CaptureStore } from "../electron/capture-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-capture-store-"));
  roots.push(root);
  const knowledgeRoot = path.join(root, "knowledge");
  const topicsDirectory = path.join(knowledgeRoot, "topics");
  const progressPath = path.join(root, "state", "progress.json");
  const plannerPath = path.join(root, "state", "planner.json");
  const settingsPath = path.join(root, "settings.json");
  await fs.mkdir(topicsDirectory, { recursive: true });
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(path.join(topicsDirectory, "bits.json"), JSON.stringify({
    schemaVersion: 2,
    revision: 1,
    id: "bits",
    title: "Bits",
    summary: "Bits",
    sources: [],
    relationships: [],
    concepts: [],
    gaps: [],
    questions: []
  }, null, 2) + "\n");
  await fs.writeFile(progressPath, JSON.stringify({
    schemaVersion: 2,
    topics: { bits: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: {} } },
    reviewEvents: []
  }, null, 2) + "\n");
  await fs.writeFile(plannerPath, JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    plans: [{
      id: "plan-one",
      examName: "Final",
      targetDate: "2030-01-01",
      topicIDs: ["bits"],
      sessionCount: 2,
      timeZone: "UTC",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }]
  }, null, 2) + "\n");
  await fs.writeFile(settingsPath, JSON.stringify({ knowledgeRootPath: knowledgeRoot, progressPath, notificationsEnabled: false }));
  return { root, knowledgeRoot, progressPath, plannerPath, settingsPath };
}

function newCapture(rawText: string) {
  return {
    expectedRevision: 0,
    topicID: "bits",
    title: "  Raw notes — keep Unicode  ",
    rawText,
    concisePoints: [
      { text: "First — repeated phrase" },
      { text: "First — repeated phrase" }
    ],
    status: "draft" as const
  };
}

describe("learner capture persistence", () => {
  it("round-trips raw text exactly and returns metadata-only summaries", async () => {
    const { knowledgeRoot } = await fixture();
    const store = new CaptureStore(knowledgeRoot);
    const rawText = "  naïve — hyphen-like dash\n\nrepeat phrase\nrepeat phrase\n\ttrailing  \n";
    const created = store.save(newCapture(rawText), new Date("2026-07-21T10:00:00.000Z"));

    expect(created).toMatchObject({ schemaVersion: 1, revision: 1, topicID: "bits", rawText, status: "draft" });
    expect(created.id).toMatch(/^capture-[A-Za-z0-9-]+$/);
    expect(created.concisePoints[0].id).toMatch(/^point-[A-Za-z0-9-]+$/);
    expect(created.concisePoints[0].id).not.toBe(created.concisePoints[1].id);
    expect(new CaptureStore(knowledgeRoot).get(created.id).rawText).toBe(rawText);

    const summaries = store.listSummaries();
    expect(summaries).toEqual([{
      id: created.id,
      revision: 1,
      topicID: "bits",
      title: "  Raw notes — keep Unicode  ",
      origin: "user",
      status: "draft",
      concisePointCount: 2,
      createdAt: "2026-07-21T10:00:00.000Z",
      updatedAt: "2026-07-21T10:00:00.000Z"
    }]);
    expect(JSON.stringify(summaries)).not.toContain("rawText");
    expect(JSON.stringify(summaries)).not.toContain("First — repeated phrase");

    const fileMode = (await fs.stat(path.join(knowledgeRoot, "captures", `${created.id}.json`))).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it("creates, edits, archives, and reloads with stable server-managed point IDs", async () => {
    const { knowledgeRoot } = await fixture();
    const firstStore = new CaptureStore(knowledgeRoot);
    const created = firstStore.save(newCapture("initial"), new Date("2026-07-21T10:00:00.000Z"));
    const retainedPointID = created.concisePoints[0].id;
    const edited = new CaptureStore(knowledgeRoot).save({
      id: created.id,
      expectedRevision: 1,
      topicID: "bits",
      title: "Edited",
      rawText: " \n\t",
      concisePoints: [{ id: retainedPointID, text: "Retained" }, { text: "New" }],
      status: "ready"
    }, new Date("2026-07-21T11:00:00.000Z"));

    expect(edited.revision).toBe(2);
    expect(edited.createdAt).toBe(created.createdAt);
    expect(edited.rawText).toBe(" \n\t");
    expect(edited.concisePoints[0].id).toBe(retainedPointID);
    expect(edited.concisePoints[1].id).toMatch(/^point-/);
    expect(edited.concisePoints[1].id).not.toBe(retainedPointID);

    const archived = new CaptureStore(knowledgeRoot).archive(created.id, 2, new Date("2026-07-21T12:00:00.000Z"));
    expect(archived).toMatchObject({ revision: 3, status: "archived", updatedAt: "2026-07-21T12:00:00.000Z" });
    expect(new CaptureStore(knowledgeRoot).get(created.id)).toEqual(archived);
    expect(() => firstStore.save({ ...newCapture("no"), id: created.id, expectedRevision: 3 })).toThrow(/archived/i);
    expect(() => firstStore.save({ ...newCapture("no"), status: "archived" })).toThrow(/status is invalid/i);
  });

  it("persists Ollama-generated notes separately from learner notes", async () => {
    const { knowledgeRoot } = await fixture();
    const generated = new CaptureStore(knowledgeRoot).createOllamaGenerated({
      topicID: "bits",
      title: "Bits — AI study note",
      rawText: "A bit represents one distinguishable state. Eight bits form a byte.",
      concisePoints: ["A bit is a distinguishable state.", "Eight bits form a byte."]
    }, new Date("2026-07-27T12:00:00.000Z"));

    expect(generated).toMatchObject({
      topicID: "bits",
      origin: "ollama",
      status: "ready",
      concisePoints: [
        { text: "A bit is a distinguishable state." },
        { text: "Eight bits form a byte." }
      ]
    });
    expect(generated.concisePoints.every((point) => point.id.startsWith("point-"))).toBe(true);
    expect(new CaptureStore(knowledgeRoot).listSummaries()).toMatchObject([{
      id: generated.id,
      origin: "ollama",
      status: "ready"
    }]);
  });

  it("treats older captures without an origin as learner-authored", async () => {
    const { knowledgeRoot } = await fixture();
    const store = new CaptureStore(knowledgeRoot);
    await fs.mkdir(store.directoryPath, { recursive: true });
    await fs.writeFile(path.join(store.directoryPath, "capture-legacy.json"), JSON.stringify({
      schemaVersion: 1,
      id: "capture-legacy",
      revision: 1,
      topicID: "bits",
      title: "Earlier note",
      rawText: "A learner wrote this before note origins existed.",
      concisePoints: [],
      status: "draft",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:00.000Z"
    }, null, 2) + "\n");

    expect(store.get("capture-legacy").origin).toBe("user");
  });

  it("rejects stale writes and client-minted or duplicate point IDs without changing disk bytes", async () => {
    const { knowledgeRoot } = await fixture();
    const store = new CaptureStore(knowledgeRoot);
    const created = store.save(newCapture("original"), new Date("2026-07-21T10:00:00.000Z"));
    const filePath = path.join(knowledgeRoot, "captures", `${created.id}.json`);
    const before = await fs.readFile(filePath);

    expect(() => store.save({
      id: created.id,
      expectedRevision: 0,
      topicID: "bits",
      title: "Stale",
      rawText: "changed",
      concisePoints: [],
      status: "draft"
    })).toThrow(expect.objectContaining({ code: "CAPTURE_REVISION_CONFLICT", expectedRevision: 0, actualRevision: 1 }));
    expect(await fs.readFile(filePath)).toEqual(before);

    expect(() => store.save({
      id: created.id,
      expectedRevision: 1,
      topicID: "bits",
      title: "Minted",
      rawText: "changed",
      concisePoints: [{ id: "client-made", text: "No" }],
      status: "draft"
    })).toThrow(/does not exist/i);
    expect(() => store.save({
      id: created.id,
      expectedRevision: 1,
      topicID: "bits",
      title: "Duplicate",
      rawText: "changed",
      concisePoints: [
        { id: created.concisePoints[0].id, text: "One" },
        { id: created.concisePoints[0].id, text: "Two" }
      ],
      status: "draft"
    })).toThrow(/point IDs must be unique/i);
    expect(await fs.readFile(filePath)).toEqual(before);
  });

  it("contains paths and rejects capture-directory or capture-file symlink escapes", async () => {
    const { root, knowledgeRoot } = await fixture();
    const outside = path.join(root, "outside");
    const captures = path.join(knowledgeRoot, "captures");
    await fs.mkdir(outside);
    await fs.symlink(outside, captures);
    const store = new CaptureStore(knowledgeRoot);
    expect(() => store.save(newCapture("escape"))).toThrow(/real directory/i);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(() => store.get("../outside")).toThrow(/invalid/i);

    await fs.unlink(captures);
    await fs.mkdir(captures);
    const externalFile = path.join(outside, "private.json");
    const externalBytes = Buffer.from("outside must remain untouched\n");
    await fs.writeFile(externalFile, externalBytes);
    await fs.symlink(externalFile, path.join(captures, "capture-link.json"));
    expect(() => store.get("capture-link")).toThrow(/symbolic link/i);
    expect(await fs.readFile(externalFile)).toEqual(externalBytes);
    expect((await fs.readdir(captures)).some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("quarantines corrupt files once while continuing to list healthy captures", async () => {
    const { knowledgeRoot } = await fixture();
    const store = new CaptureStore(knowledgeRoot);
    const healthy = store.save(newCapture("healthy"), new Date("2026-07-21T10:00:00.000Z"));
    await fs.writeFile(path.join(store.directoryPath, "capture-broken.json"), "{not-json", "utf8");

    expect(store.listSummaries().map((summary) => summary.id)).toEqual([healthy.id]);
    const afterFirstList = await fs.readdir(store.directoryPath);
    expect(afterFirstList.some((name) => /^capture-broken\.corrupt-.*\.json$/.test(name))).toBe(true);
    expect(store.listSummaries().map((summary) => summary.id)).toEqual([healthy.id]);
    expect(await fs.readdir(store.directoryPath)).toEqual(afterFirstList);
  });

  it("enforces live topic references and never mutates snapshot topics, progress, or planner", async () => {
    const { knowledgeRoot, progressPath, settingsPath } = await fixture();
    const state = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath });
    try {
      const before = JSON.stringify(state.snapshot);
      const saved = state.saveCapture(newCapture("state boundary"));
      expect(JSON.stringify(state.snapshot)).toBe(before);
      expect(state.listCaptureSummaries()).toHaveLength(1);
      expect(state.getCapture(saved.id)).toEqual(saved);
      const archived = state.archiveCapture(saved.id, 1);
      expect(archived.status).toBe("archived");
      expect(JSON.stringify(state.snapshot)).toBe(before);
      expect(() => state.saveCapture({ ...newCapture("missing"), topicID: "missing-topic" })).toThrow(/missing topic/i);
      expect(JSON.stringify(state.snapshot)).toBe(before);
    } finally {
      state.dispose();
    }
  });
});
