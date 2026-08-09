import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RevemberState } from "../electron/app-state";
import { applyReviewEvent } from "../shared/domain";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("schedule decision persistence", () => {
  it("persists a nested decision and current-card link across restart", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();

    try {
      const result = state.commitReview(reviewInput());

      expect(result.wasInserted).toBe(true);
      expect(result.scheduleDecision).toEqual(result.event.scheduleDecision);
      expect(result.scheduleDecision).toMatchObject({
        schemaVersion: 1,
        id: "schedule-event-1",
        sourceReviewEventID: "event-1",
        reason: "first-review",
        result: {
          schedulerVersion: "simple-v1",
          questionRevision: 1,
          dueAt: "2026-08-03T00:00:00.000Z",
          intervalDays: 2,
          reviews: 1,
          lastReviewedAt: "2026-08-01T00:00:00.000Z"
        }
      });
      expect(result.scheduleDecision?.decidedAt >= result.event.reviewedAt).toBe(true);
      expect(result.cardState.scheduleDecisionID).toBe("schedule-event-1");

      const persisted = JSON.parse(await fs.readFile(fixture.progressPath, "utf8"));
      expect(persisted.reviewEvents[0].scheduleDecision).toEqual(result.scheduleDecision);
      expect(persisted.topics[topicID].reviewCardsByQuestionID[questionID].scheduleDecisionID)
        .toBe("schedule-event-1");
    } finally {
      state.dispose();
    }

    const restarted = fixture.createState();
    try {
      const event = restarted.snapshot.progress.reviewEvents[0];
      const card = restarted.snapshot.progress.topics[topicID].reviewCardsByQuestionID[questionID];

      expect(restarted.snapshot.errorMessage).toBeUndefined();
      expect(event.scheduleDecision?.id).toBe("schedule-event-1");
      expect(card.scheduleDecisionID).toBe(event.scheduleDecision?.id);
      expect(card).toMatchObject(event.scheduleDecision?.result ?? {});
    } finally {
      restarted.dispose();
    }
  });

  it("treats an identical retry as idempotent without duplicating its decision", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();

    try {
      const first = state.commitReview(reviewInput());
      const progressAfterFirst = JSON.stringify(state.snapshot.progress);
      const bytesAfterFirst = await fs.readFile(fixture.progressPath);
      const retry = state.commitReview(reviewInput());

      expect(retry.wasInserted).toBe(false);
      expect(retry.scheduleDecision).toEqual(first.scheduleDecision);
      expect(retry.event).toEqual(first.event);
      expect(state.snapshot.progress.reviewEvents).toHaveLength(1);
      expect(JSON.stringify(state.snapshot.progress)).toBe(progressAfterFirst);
      expect(await fs.readFile(fixture.progressPath)).toEqual(bytesAfterFirst);
    } finally {
      state.dispose();
    }
  });

  it("chains two chronological decisions through the immediate prior review", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();

    try {
      const first = state.commitReview(reviewInput());
      const second = state.commitReview(reviewInput({
        eventID: "event-2",
        reviewedAt: "2026-08-03T00:00:00.000Z"
      }));

      expect(second.scheduleDecision).toMatchObject({
        id: "schedule-event-2",
        sourceReviewEventID: "event-2",
        previousReviewEventID: "event-1",
        previousScheduleDecisionID: first.scheduleDecision?.id,
        reason: "review",
        result: {
          intervalDays: 4.4,
          reviews: 2
        }
      });
      expect(second.cardState.scheduleDecisionID).toBe("schedule-event-2");
      expect(state.snapshot.progress.reviewEvents.map((event) => event.scheduleDecision?.id))
        .toEqual(["schedule-event-1", "schedule-event-2"]);
    } finally {
      state.dispose();
    }
  });

  it("returns the original decision state when an old event is retried after a later review", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();

    try {
      const firstInput = reviewInput();
      state.commitReview(firstInput);
      const latest = state.commitReview(reviewInput({
        eventID: "event-2",
        reviewedAt: "2026-08-03T00:00:00.000Z"
      }));
      const retry = state.commitReview(firstInput);

      expect(retry.wasInserted).toBe(false);
      expect(retry.cardState).toMatchObject({
        scheduleDecisionID: "schedule-event-1",
        intervalDays: 2,
        reviews: 1
      });
      expect(retry.snapshot.progress.topics[topicID].reviewCardsByQuestionID[questionID]).toEqual(latest.cardState);
    } finally {
      state.dispose();
    }
  });

  it("starts a revision-reset decision chain after the authored question changes", async () => {
    const fixture = await stateFixture();
    const original = fixture.createState();
    try {
      original.commitReview(reviewInput());
    } finally {
      original.dispose();
    }

    const revisedTopic = topicFixture();
    revisedTopic.revision = 2;
    revisedTopic.questions[0].revision = 2;
    await writeTopic(fixture.knowledgeRoot, revisedTopic);

    const revised = fixture.createState();
    try {
      const result = revised.commitReview(reviewInput({
        questionRevision: 2,
        eventID: "event-revision-2",
        reviewedAt: "2026-08-02T00:00:00.000Z"
      }));

      expect(result.scheduleDecision).toMatchObject({
        id: "schedule-event-revision-2",
        reason: "revision-reset",
        result: {
          questionRevision: 2,
          intervalDays: 2,
          reviews: 1
        }
      });
      expect(result.scheduleDecision?.previousReviewEventID).toBeUndefined();
      expect(result.scheduleDecision?.previousScheduleDecisionID).toBeUndefined();
      expect(result.cardState.scheduleDecisionID).toBe("schedule-event-revision-2");
    } finally {
      revised.dispose();
    }
  });

  it("accepts a legacy review appended after an instrumented review", async () => {
    const fixture = await stateFixture();
    const instrumented = fixture.createState();
    try {
      instrumented.commitReview(reviewInput());
    } finally {
      instrumented.dispose();
    }

    const oldStyleProgress = JSON.parse(await fs.readFile(fixture.progressPath, "utf8"));
    const firstDecidedAt = oldStyleProgress.reviewEvents[0].scheduleDecision.decidedAt as string;
    const legacyReviewedAt = firstDecidedAt;
    const nextReviewedAt = firstDecidedAt;
    const { scheduleDecision: _decision, ...firstEvent } = oldStyleProgress.reviewEvents[0];
    applyReviewEvent(oldStyleProgress, {
      ...firstEvent,
      id: "event-legacy",
      reviewedAt: legacyReviewedAt
    });
    await fs.writeFile(fixture.progressPath, JSON.stringify(oldStyleProgress));

    const resumed = fixture.createState();
    try {
      const legacyEvent = resumed.snapshot.progress.reviewEvents[1];
      const legacyCard = resumed.snapshot.progress.topics[topicID].reviewCardsByQuestionID[questionID];
      expect(resumed.snapshot.errorMessage).toBeUndefined();
      expect(legacyEvent.scheduleDecision).toBeUndefined();
      expect(legacyCard.scheduleDecisionID).toBeUndefined();

      const next = resumed.commitReview(reviewInput({
        eventID: "event-after-legacy",
        reviewedAt: nextReviewedAt
      }));
      expect(next.scheduleDecision).toMatchObject({
        previousReviewEventID: "event-legacy",
        reason: "review"
      });
      expect(next.scheduleDecision?.previousScheduleDecisionID).toBeUndefined();
    } finally {
      resumed.dispose();
    }
  });

  it("rejects an out-of-order new event without changing memory or disk", async () => {
    const fixture = await stateFixture();
    const state = fixture.createState();

    try {
      state.commitReview(reviewInput({
        eventID: "event-later",
        reviewedAt: "2026-08-02T00:00:00.000Z"
      }));
      const progressBefore = JSON.stringify(state.snapshot.progress);
      const bytesBefore = await fs.readFile(fixture.progressPath);

      expect(() => state.commitReview(reviewInput({
        eventID: "event-earlier",
        reviewedAt: "2026-08-01T00:00:00.000Z"
      }))).toThrow(/cannot be recorded before this question's latest outcome/i);

      expect(JSON.stringify(state.snapshot.progress)).toBe(progressBefore);
      expect(await fs.readFile(fixture.progressPath)).toEqual(bytesBefore);
    } finally {
      state.dispose();
    }
  });

  it("rejects a newer question revision timestamped before the prior revision", async () => {
    const fixture = await stateFixture();
    const original = fixture.createState();
    try {
      original.commitReview(reviewInput({ reviewedAt: "2026-08-02T00:00:00.000Z" }));
    } finally {
      original.dispose();
    }

    const revisedTopic = topicFixture();
    revisedTopic.revision = 2;
    revisedTopic.questions[0].revision = 2;
    await writeTopic(fixture.knowledgeRoot, revisedTopic);
    const revised = fixture.createState();

    try {
      const progressBefore = JSON.stringify(revised.snapshot.progress);
      const bytesBefore = await fs.readFile(fixture.progressPath);
      expect(() => revised.commitReview(reviewInput({
        questionRevision: 2,
        eventID: "event-revision-2-early",
        reviewedAt: "2026-08-01T00:00:00.000Z"
      }))).toThrow(/cannot be recorded before this question's latest outcome/i);
      expect(JSON.stringify(revised.snapshot.progress)).toBe(progressBefore);
      expect(await fs.readFile(fixture.progressPath)).toEqual(bytesBefore);
    } finally {
      revised.dispose();
    }
  });
});

const topicID = "topic";
const questionID = "question";

async function stateFixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-schedule-decision-"));
  temporaryRoots.push(root);
  const knowledgeRoot = path.join(root, "knowledge");
  const progressPath = path.join(root, "state", "progress.json");
  const settingsPath = path.join(root, "settings.json");
  await writeTopic(knowledgeRoot, topicFixture());
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify({ schemaVersion: 2, topics: {}, reviewEvents: [] }));
  await fs.writeFile(settingsPath, JSON.stringify({
    knowledgeRootPath: knowledgeRoot,
    progressPath,
    notificationsEnabled: false
  }));
  return {
    knowledgeRoot,
    progressPath,
    createState: () => new RevemberState({
      settingsPath,
      bundledKnowledgeRoot: knowledgeRoot,
      legacyProgressPath: progressPath
    })
  };
}

async function writeTopic(knowledgeRoot: string, topic: ReturnType<typeof topicFixture>): Promise<void> {
  const topicsPath = path.join(knowledgeRoot, "topics");
  await fs.mkdir(topicsPath, { recursive: true });
  await fs.writeFile(path.join(topicsPath, `${topic.id}.json`), JSON.stringify(topic));
}

function topicFixture() {
  return {
    schemaVersion: 2,
    revision: 1,
    id: topicID,
    title: "Topic",
    summary: "Topic summary",
    sources: [],
    relationships: [],
    concepts: [{
      id: "concept",
      title: "Concept",
      firstPrinciples: "A state",
      explanation: "A measurable distinction"
    }],
    gaps: [],
    questions: [{
      id: questionID,
      revision: 1,
      kind: "multipleChoice",
      transferLevel: "recall",
      prompt: "Which choice is correct?",
      difficulty: "intro",
      conceptIDs: ["concept"],
      gapTags: [],
      sourceRefs: [],
      choices: [
        { id: "correct", text: "Correct", isCorrect: true },
        { id: "wrong", text: "Wrong", isCorrect: false }
      ],
      explanation: "Correct."
    }]
  };
}

function reviewInput(replacement: Record<string, unknown> = {}) {
  return {
    topicID,
    questionID,
    questionRevision: 1,
    choiceID: "correct",
    rating: "good" as const,
    eventID: "event-1",
    reviewedAt: "2026-08-01T00:00:00.000Z",
    ...replacement
  };
}
