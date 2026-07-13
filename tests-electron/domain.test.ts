import { describe, expect, test } from "vitest";
import {
  applyReviewEvent,
  dueReviewItems,
  emptyProgress,
  intervalFor,
  normalizeTopic,
  scheduleReview
} from "../shared/domain";
import type { AppSnapshot, KnowledgeTopic, ReviewEvent } from "../shared/types";

const topic = normalizeTopic({
  schemaVersion: 2,
  revision: 1,
  id: "bits",
  title: "Bits",
  summary: "Physical information",
  concepts: [{ id: "bit", title: "Bit", firstPrinciples: "A state", explanation: "A measurable distinction", relatedTerms: [], confusableTerms: [], gapTags: [] }],
  gaps: [],
  questions: [{
    id: "q1", revision: 1, kind: "multipleChoice", transferLevel: "recall", prompt: "What is a bit?", difficulty: "intro",
    conceptIDs: ["bit"], gapTags: [], choices: [{ id: "a", text: "A state", isCorrect: true }, { id: "b", text: "A byte", isCorrect: false }], explanation: "A state."
  }]
});

describe("legacy-compatible scheduler", () => {
  test("uses the established first-review intervals", () => {
    expect(intervalFor(undefined, "missed")).toBeCloseTo(15 / 1440);
    expect(intervalFor(undefined, "hard")).toBe(1);
    expect(intervalFor(undefined, "good")).toBe(2);
    expect(intervalFor(undefined, "easy")).toBe(4);
  });

  test("replays events chronologically and updates compatibility aggregates", () => {
    const progress = emptyProgress();
    const later = event("later", "2026-07-03T00:00:00.000Z", "good");
    const earlier = event("earlier", "2026-07-01T00:00:00.000Z", "hard");
    applyReviewEvent(progress, later);
    const state = applyReviewEvent(progress, earlier);
    expect(state.reviews).toBe(2);
    expect(state.intervalDays).toBeCloseTo(2.2);
    expect(progress.topics.bits.attemptsByQuestionID.q1.attempts).toBe(2);
    expect(progress.reviewEvents.map((candidate) => candidate.id)).toEqual(["later", "earlier"]);
  });

  test("incorrect answers always schedule as missed", () => {
    const progress = emptyProgress();
    const missed = { ...event("wrong", "2026-07-01T00:00:00.000Z", "easy"), isCorrect: false };
    const state = applyReviewEvent(progress, missed);
    expect(state.lastRating).toBe("missed");
    expect(state.intervalDays).toBeCloseTo(15 / 1440);
    expect(progress.topics.bits.weakConceptIDs.bit).toBe(1);
  });
});

describe("review queue", () => {
  test("prioritizes scheduled, revised, then new checks", () => {
    const revisedTopic: KnowledgeTopic = { ...topic, id: "revised", questions: [{ ...topic.questions[0], revision: 2 }] };
    const scheduledTopic: KnowledgeTopic = { ...topic, id: "scheduled" };
    const snapshot: Pick<AppSnapshot, "topics" | "progress"> = {
      topics: [topic, revisedTopic, scheduledTopic],
      progress: {
        schemaVersion: 2,
        reviewEvents: [],
        topics: {
          revised: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { q1: { ...scheduleReview(undefined, "good", "2026-06-01T00:00:00.000Z"), questionRevision: 1 } } },
          scheduled: { attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID: { q1: { ...scheduleReview(undefined, "good", "2026-06-01T00:00:00.000Z"), questionRevision: 1 } } }
        }
      }
    };
    expect(dueReviewItems(snapshot, new Date("2026-07-01T00:00:00.000Z")).map((item) => item.topicID)).toEqual(["scheduled", "revised", "bits"]);
  });
});

describe("topic validation", () => {
  test("rejects dangling sources and duplicate answer IDs", () => {
    expect(() => normalizeTopic({
      ...topic,
      concepts: [{ ...topic.concepts[0], sourceRefs: ["missing"] }],
      questions: [{ ...topic.questions[0], choices: [{ id: "a", text: "yes", isCorrect: true }, { id: "a", text: "no", isCorrect: false }] }]
    })).toThrow(/missing source|duplicate choice/);
  });

  test("fills legacy v1 defaults without changing IDs", () => {
    const legacy = normalizeTopic({
      id: "legacy", title: "Legacy", summary: "Legacy topic",
      concepts: [{ id: "c", title: "Concept", firstPrinciples: "First", explanation: "Detail" }],
      gaps: [],
      questions: [{ id: "q", prompt: "Question?", difficulty: "intro", conceptIDs: ["c"], gapTags: [], choices: [{ id: "a", text: "Yes", isCorrect: true }, { id: "b", text: "No", isCorrect: false }], explanation: "Yes" }]
    });
    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.questions[0].revision).toBe(1);
    expect(legacy.questions[0].kind).toBe("multipleChoice");
  });
});

function event(id: string, reviewedAt: string, rating: ReviewEvent["rating"]): ReviewEvent {
  return {
    id, topicID: "bits", questionID: "q1", questionRevision: 1, choiceID: "a", isCorrect: true, rating,
    conceptIDs: ["bit"], gapTags: [], misconceptionIDs: [], sourceRefs: [], reviewedAt
  };
}
