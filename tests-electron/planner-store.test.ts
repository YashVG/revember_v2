import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { PlannerStore } from "../electron/planner-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-planner-store-"));
  roots.push(root);
  const knowledgeRoot = path.join(root, "knowledge");
  const topicsDirectory = path.join(knowledgeRoot, "topics");
  const progressPath = path.join(root, "state", "progress.json");
  const settingsPath = path.join(root, "settings.json");
  await fs.mkdir(topicsDirectory, { recursive: true });
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(path.join(topicsDirectory, "bits.json"), JSON.stringify({
    schemaVersion: 2, revision: 1, id: "bits", title: "Bits", summary: "Bits",
    sources: [], relationships: [], concepts: [], gaps: [], questions: [{
      id: "q1", revision: 1, kind: "multipleChoice", transferLevel: "recall", prompt: "A bit?",
      difficulty: "intro", conceptIDs: [], gapTags: [], sourceRefs: [], explanation: "A state.",
      choices: [{ id: "yes", text: "State", isCorrect: true }, { id: "no", text: "Packet", isCorrect: false }]
    }]
  }, null, 2) + "\n");
  const dueAt = "2030-01-02T03:04:05.000Z";
  await fs.writeFile(progressPath, JSON.stringify({
    schemaVersion: 2,
    topics: { bits: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: {
      q1: { schedulerVersion: "simple-v1", questionRevision: 1, dueAt, intervalDays: 2, stability: 2, difficulty: 5, lapses: 0, reviews: 1 }
    } } },
    reviewEvents: []
  }, null, 2) + "\n");
  await fs.writeFile(settingsPath, JSON.stringify({ knowledgeRootPath: knowledgeRoot, progressPath, notificationsEnabled: false }));
  return { root, knowledgeRoot, progressPath, settingsPath, dueAt };
}

function futureTargetDate(): string {
  return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
}

describe("planner persistence", () => {
  it("writes atomically, reloads across store instances, and rejects stale revisions", async () => {
    const { progressPath } = await fixture();
    const first = new PlannerStore(progressPath);
    const written = first.upsert({
      expectedPlannerRevision: 0,
      plan: { examName: "Final", targetDate: futureTargetDate(), topicIDs: ["bits"], sessionCount: 2, timeZone: "UTC" }
    }, new Date("2026-03-01T12:00:00.000Z"));
    expect(written.record.revision).toBe(1);
    expect(new PlannerStore(progressPath).load().record).toEqual(written.record);
    const stateFiles = await fs.readdir(path.dirname(progressPath));
    expect(stateFiles.some((name) => /^planner\.json\.tmp-/.test(name))).toBe(false);
    expect(() => first.upsert({
      expectedPlannerRevision: 0,
      plan: { examName: "Stale", targetDate: futureTargetDate(), topicIDs: ["bits"], sessionCount: 1, timeZone: "UTC" }
    })).toThrow(expect.objectContaining({ code: "PLANNER_REVISION_CONFLICT", actualRevision: 1 }));
  });

  it("quarantines corrupt planner data without preventing topics or progress from loading", async () => {
    const { root, knowledgeRoot, progressPath, settingsPath, dueAt } = await fixture();
    const plannerPath = new PlannerStore(progressPath).filePath;
    await fs.writeFile(plannerPath, "{not-json", "utf8");
    const state = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath });
    try {
      expect(state.snapshot.topics.map((topic) => topic.id)).toEqual(["bits"]);
      expect(state.snapshot.progress.topics.bits.reviewCardsByQuestionID.q1.dueAt).toBe(dueAt);
      expect(state.snapshot.planner).toEqual({ schemaVersion: 1, revision: 0, plans: [] });
      expect(state.snapshot.errorMessage).toMatch(/Planner data was unreadable and moved/i);
      const names = await fs.readdir(path.join(root, "state"));
      expect(names.some((name) => /^planner\.corrupt-.*\.json$/.test(name))).toBe(true);
    } finally {
      state.dispose();
    }
  });

  it("loads planner state into snapshots and never changes scheduler dueAt", async () => {
    const { knowledgeRoot, progressPath, settingsPath, dueAt } = await fixture();
    const state = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath });
    try {
      const result = state.upsertExamPlan({
        expectedPlannerRevision: 0,
        plan: { examName: "Final", targetDate: futureTargetDate(), topicIDs: ["bits"], sessionCount: 1, timeZone: "UTC" }
      });
      expect(result.snapshot.planner.revision).toBe(1);
      expect(result.snapshot.progress.topics.bits.reviewCardsByQuestionID.q1.dueAt).toBe(dueAt);
    } finally {
      state.dispose();
    }
    const restarted = new RevemberState({ settingsPath, bundledKnowledgeRoot: knowledgeRoot, legacyProgressPath: progressPath });
    try {
      expect(restarted.snapshot.planner.revision).toBe(1);
      expect(restarted.snapshot.progress.topics.bits.reviewCardsByQuestionID.q1.dueAt).toBe(dueAt);
    } finally {
      restarted.dispose();
    }
  });
});
