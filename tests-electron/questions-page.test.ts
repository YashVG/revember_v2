import { describe, expect, test } from "vitest";
import { normalizeTopic, scheduleReview } from "../shared/domain";
import type { AppSnapshot, DueReviewItem, KnowledgeTopic } from "../shared/types";
import { buildQuestionReviewQueues, buildTopicQuestionSets, questionReviewDockAction } from "../src/renderer/src/components/QuestionsPage";

const baseTopic = normalizeTopic({
  schemaVersion: 2,
  revision: 1,
  id: "base",
  title: "Base",
  summary: "Queue test topic",
  concepts: [{ id: "concept", title: "Concept", firstPrinciples: "A principle", explanation: "An explanation" }],
  gaps: [],
  questions: [{
    id: "question",
    revision: 1,
    kind: "multipleChoice",
    transferLevel: "recall",
    prompt: "What belongs in this queue?",
    difficulty: "intro",
    conceptIDs: ["concept"],
    gapTags: [],
    choices: [{ id: "yes", text: "Yes", isCorrect: true }, { id: "no", text: "No", isCorrect: false }],
    explanation: "The queue follows the current schedule."
  }]
});

function topic(id: string, revision = 1): KnowledgeTopic {
  return { ...baseTopic, id, questions: [{ ...baseTopic.questions[0], revision }] };
}

describe("Questions review queue", () => {
  test("separates due, new, revised, and future-scheduled questions", () => {
    const due = topic("due");
    const fresh = topic("fresh");
    const revised = topic("revised", 2);
    const scheduled = topic("scheduled");
    const snapshot: Pick<AppSnapshot, "topics" | "progress"> = {
      topics: [due, fresh, revised, scheduled],
      progress: {
        schemaVersion: 2,
        reviewEvents: [],
        topics: {
          due: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { question: scheduleReview(undefined, "good", "2026-07-01T00:00:00.000Z") } },
          revised: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { question: scheduleReview(undefined, "good", "2026-07-01T00:00:00.000Z") } },
          scheduled: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { question: scheduleReview(undefined, "good", "2026-08-01T00:00:00.000Z") } }
        }
      }
    };

    const queues = buildQuestionReviewQueues(snapshot, new Date("2026-07-15T00:00:00.000Z"));

    expect(queues.due.map((item) => item.topicID)).toEqual(["due"]);
    expect(queues.fresh.map((item) => item.topicID)).toEqual(["fresh"]);
    expect(queues.revised.map((item) => item.topicID)).toEqual(["revised"]);
    expect(queues.revised[0].isRevised).toBe(true);
    expect(queues.scheduled.map((item) => item.topicID)).toEqual(["scheduled"]);
    expect(queues.scheduled[0].isScheduled).toBe(true);
  });

  test("prioritizes due questions and never starts a future-scheduled queue", () => {
    const item = (id: string): DueReviewItem => ({
      id,
      topicID: baseTopic.id,
      questionID: baseTopic.questions[0].id,
      topic: baseTopic,
      question: baseTopic.questions[0]
    });

    const due = questionReviewDockAction({ due: [item("due")], fresh: [item("new")], revised: [item("revised")], scheduled: [item("scheduled")] });
    expect(due.label).toBe("Start 1 due now");
    expect(due.sessionLabel).toBe("Due now");
    expect(due.items.map((entry) => entry.id)).toEqual(["due"]);

    const refreshed = questionReviewDockAction({ due: [], fresh: [item("new")], revised: [item("revised")], scheduled: [item("scheduled")] });
    expect(refreshed.label).toBe("Start 1 question to refresh");
    expect(refreshed.items.map((entry) => entry.id)).toEqual(["revised"]);

    const empty = questionReviewDockAction({ due: [], fresh: [], revised: [], scheduled: [item("scheduled")] });
    expect(empty.items).toEqual([]);
    expect(empty.description).toBe("1 question is scheduled for later.");
  });

  test("groups ready questions into a single review action for each topic", () => {
    const due = topic("due");
    const fresh = topic("fresh");
    const scheduled = topic("scheduled");
    const snapshot: Pick<AppSnapshot, "topics" | "progress"> = {
      topics: [due, fresh, scheduled],
      progress: {
        schemaVersion: 2,
        reviewEvents: [],
        topics: {
          due: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { question: scheduleReview(undefined, "good", "2026-07-01T00:00:00.000Z") } },
          scheduled: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { question: scheduleReview(undefined, "good", "2026-08-01T00:00:00.000Z") } }
        }
      }
    };

    const sets = buildTopicQuestionSets(snapshot, new Date("2026-07-15T00:00:00.000Z"));
    const dueSet = sets.find((set) => set.topic.id === "due")!;
    const freshSet = sets.find((set) => set.topic.id === "fresh")!;
    const scheduledSet = sets.find((set) => set.topic.id === "scheduled")!;

    expect(dueSet).toMatchObject({ dueCount: 1, questionCount: 1 });
    expect(dueSet.reviewItems.map((item) => item.topicID)).toEqual(["due"]);
    expect(freshSet).toMatchObject({ freshCount: 1, questionCount: 1 });
    expect(freshSet.reviewItems.map((item) => item.topicID)).toEqual(["fresh"]);
    expect(scheduledSet).toMatchObject({ scheduledCount: 1, questionCount: 1 });
    expect(scheduledSet.reviewItems).toEqual([]);
  });
});
