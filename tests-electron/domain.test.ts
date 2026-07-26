import { describe, expect, test } from "vitest";
import {
  applyReviewEvent,
  currentEvidence,
  dueReviewItems,
  emptyProgress,
  intervalFor,
  nextDueAt,
  normalizeProgress,
  normalizeTopic,
  progressSummary,
  scheduleReview,
  weakConceptIDs
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

describe("current evidence projections", () => {
  test("isolates topics, active questions, and current revisions while preserving ledger ordering", () => {
    const projectionTopic = normalizeTopic({
      schemaVersion: 2,
      revision: 2,
      id: "projection",
      title: "Projection",
      summary: "Revision-aware evidence",
      concepts: [
        { id: "alpha", title: "Alpha", firstPrinciples: "Alpha", explanation: "Alpha" },
        { id: "beta", title: "Beta", firstPrinciples: "Beta", explanation: "Beta" },
        { id: "gamma", title: "Gamma", firstPrinciples: "Gamma", explanation: "Gamma" }
      ],
      gaps: [],
      questions: [
        {
          id: "revised",
          revision: 2,
          prompt: "Revised?",
          difficulty: "intro",
          conceptIDs: ["alpha"],
          choices: choices(),
          explanation: "Yes."
        },
        {
          id: "current",
          revision: 1,
          prompt: "Current?",
          difficulty: "intro",
          conceptIDs: ["alpha", "beta"],
          choices: choices(),
          explanation: "Yes."
        },
        {
          id: "legacy",
          revision: 1,
          prompt: "Legacy?",
          difficulty: "intro",
          conceptIDs: ["gamma"],
          choices: choices(),
          explanation: "Yes."
        },
        {
          id: "retired",
          revision: 1,
          retiredAt: "2026-07-01T00:00:00.000Z",
          prompt: "Retired?",
          difficulty: "intro",
          conceptIDs: ["beta"],
          choices: choices(),
          explanation: "Yes."
        }
      ]
    });
    const progress = emptyProgress();
    progress.topics.projection = {
      attemptsByQuestionID: { legacy: { attempts: 2, correctAttempts: 1 } },
      weakConceptIDs: { ghost: 10, gamma: 4, beta: 2 },
      reviewCardsByQuestionID: {}
    };
    progress.reviewEvents.push(
      projectionEvent("other-topic", "elsewhere", "revised", 2, "missed", false, "2026-07-06T00:00:00.000Z"),
      projectionEvent("obsolete", "projection", "revised", 1, "missed", false, "2026-07-05T00:00:00.000Z"),
      projectionEvent("current-hard", "projection", "current", 1, "hard", true, "2026-07-03T00:00:00.000Z"),
      projectionEvent("revised-hard", "projection", "revised", 2, "hard", true, "2026-07-04T00:00:00.000Z"),
      projectionEvent("current-good", "projection", "current", 1, "good", true, "2026-07-03T00:00:00.000Z"),
      projectionEvent("current-older", "projection", "current", 1, "missed", false, "2026-07-02T00:00:00.000Z"),
      projectionEvent("retired-current", "projection", "retired", 1, "missed", false, "2026-07-07T00:00:00.000Z")
    );

    expect(currentEvidence(projectionTopic, progress)).toEqual({
      attempts: 6,
      correct: 4,
      score: 4 / 6
    });
    expect(progressSummary(projectionTopic, progress)).toBe("67% across 6 current answers");
    expect(weakConceptIDs(projectionTopic, progress)).toEqual(["alpha", "gamma"]);
  });

  test("current stable evidence clears lifetime legacy weakness for that concept", () => {
    const progress = emptyProgress();
    progress.topics.bits = {
      attemptsByQuestionID: {},
      weakConceptIDs: { bit: 7 },
      reviewCardsByQuestionID: {}
    };
    progress.reviewEvents.push(event("current-good", "2026-07-03T00:00:00.000Z", "good"));

    expect(weakConceptIDs(topic, progress)).toEqual([]);
  });
});

describe("progress validation", () => {
  test("preserves alternate schedulers and forward-compatible card fields", () => {
    const progress = normalizeProgress(progressWithCard({
      ...validCard(),
      schedulerVersion: "future-v2",
      dueAt: "2026-08-01T04:00:00+04:00",
      schedulerParameters: { retention: 0.9 }
    }));
    const card = progress.topics.bits.reviewCardsByQuestionID.q1 as typeof progress.topics.bits.reviewCardsByQuestionID.q1 & {
      schedulerParameters: { retention: number };
    };
    expect(card.schedulerVersion).toBe("future-v2");
    expect(card.schedulerParameters).toEqual({ retention: 0.9 });
    expect(card.dueAt).toBe("2026-08-01T00:00:00.000Z");
  });

  test("canonicalizes mixed-offset scheduler timestamps before chronological sorting", () => {
    const earlierTopic = { ...topic, id: "earlier" };
    const laterTopic = { ...topic, id: "later" };
    const progress = normalizeProgress({
      schemaVersion: 2,
      topics: {
        earlier: {
          attemptsByQuestionID: {},
          weakConceptIDs: {},
          reviewCardsByQuestionID: {
            q1: { ...validCard(), dueAt: "2026-08-01T04:00:00+04:00" }
          }
        },
        later: {
          attemptsByQuestionID: {},
          weakConceptIDs: {},
          reviewCardsByQuestionID: {
            q1: { ...validCard(), dueAt: "2026-07-31T23:30:00-01:00" }
          }
        }
      },
      reviewEvents: []
    });

    expect(progress.topics.earlier.reviewCardsByQuestionID.q1.dueAt).toBe("2026-08-01T00:00:00.000Z");
    expect(progress.topics.later.reviewCardsByQuestionID.q1.dueAt).toBe("2026-08-01T00:30:00.000Z");
    expect(nextDueAt({ topics: [laterTopic, earlierTopic], progress })).toBe("2026-08-01T00:00:00.000Z");
  });

  test("normalizes legacy review events and preserves JSON-safe extension fields", () => {
    const progress = normalizeProgress(progressWithEvents([{
      id: "legacy-event",
      topicID: "bits",
      questionID: "q1",
      choiceID: "a",
      isCorrect: true,
      rating: "good",
      reviewedAt: "2026-08-01T04:00:00+04:00",
      extension: { confidence: 0.8 }
    }]));
    const normalized = progress.reviewEvents[0] as ReviewEvent & { extension: { confidence: number } };

    expect(normalized).toMatchObject({
      id: "legacy-event",
      questionRevision: 1,
      conceptIDs: [],
      gapTags: [],
      misconceptionIDs: [],
      sourceRefs: [],
      reviewedAt: "2026-08-01T00:00:00.000Z",
      extension: { confidence: 0.8 }
    });
  });

  test.each([
    ["numeric ID", { id: 17 }, /id must be a non-empty string/],
    ["invalid rating", { rating: "perfect" }, /rating is invalid/],
    ["invalid timestamp", { reviewedAt: "2026-02-30T00:00:00.000Z" }, /reviewedAt must be an ISO timestamp/],
    ["non-string array member", { conceptIDs: ["bit", 17] }, /conceptIDs must be an array of strings/],
    ["invalid question kind", { questionKind: "essay" }, /questionKind is invalid/]
  ])("rejects review events with %s", (_name, replacement, message) => {
    expect(() => normalizeProgress(progressWithEvents([{ ...validReviewEvent(), ...replacement }]))).toThrow(message);
  });

  test("rejects non-JSON-safe review event extensions", () => {
    expect(() => normalizeProgress(progressWithEvents([{
      ...validReviewEvent(),
      extension: () => "unsafe"
    }]))).toThrow(/field extension must be JSON-safe/);
  });

  test.each([
    ["matching payloads", { ...validReviewEvent(), id: "EVENT" }],
    ["conflicting payloads", { ...validReviewEvent(), id: "EVENT", rating: "hard" }]
  ])("rejects case-insensitive duplicate review event IDs with %s", (_name, duplicate) => {
    expect(() => normalizeProgress(progressWithEvents([
      validReviewEvent(),
      duplicate
    ]))).toThrow(/duplicate review event ID EVENT/);
  });

  test.each([
    ["invalid dueAt", { ...validCard(), dueAt: "not-a-date" }, /dueAt must be an ISO timestamp/],
    ["date-only dueAt", { ...validCard(), dueAt: "2026-08-01" }, /dueAt must be an ISO timestamp/],
    ["impossible dueAt", { ...validCard(), dueAt: "2026-02-30T00:00:00.000Z" }, /dueAt must be an ISO timestamp/],
    ["empty scheduler", { ...validCard(), schedulerVersion: " " }, /schedulerVersion must be a non-empty string/],
    ["non-finite interval", { ...validCard(), intervalDays: Number.NaN }, /intervalDays must be a positive finite number/],
    ["invalid difficulty", { ...validCard(), difficulty: 11 }, /difficulty must be between 1 and 10/],
    ["fractional review count", { ...validCard(), reviews: 1.5 }, /reviews must be a non-negative integer/]
  ])("rejects %s", (_name, card, message) => {
    expect(() => normalizeProgress(progressWithCard(card))).toThrow(message);
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

function projectionEvent(
  id: string,
  topicID: string,
  questionID: string,
  questionRevision: number,
  rating: ReviewEvent["rating"],
  isCorrect: boolean,
  reviewedAt: string
): ReviewEvent {
  return {
    id,
    topicID,
    questionID,
    questionRevision,
    choiceID: isCorrect ? "yes" : "no",
    isCorrect,
    rating,
    conceptIDs: [],
    gapTags: [],
    misconceptionIDs: [],
    sourceRefs: [],
    reviewedAt
  };
}

function choices() {
  return [
    { id: "yes", text: "Yes", isCorrect: true },
    { id: "no", text: "No", isCorrect: false }
  ];
}

function validCard() {
  return {
    schedulerVersion: "simple-v1",
    questionRevision: 1,
    dueAt: "2026-08-01T00:00:00.000Z",
    intervalDays: 2,
    stability: 2,
    difficulty: 5,
    lapses: 0,
    reviews: 1
  };
}

function progressWithCard(card: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    topics: {
      bits: {
        attemptsByQuestionID: {},
        weakConceptIDs: {},
        reviewCardsByQuestionID: { q1: card }
      }
    },
    reviewEvents: []
  };
}

function validReviewEvent(): Record<string, unknown> {
  return {
    id: "event",
    topicID: "bits",
    questionID: "q1",
    questionRevision: 1,
    choiceID: "a",
    isCorrect: true,
    rating: "good",
    conceptIDs: ["bit"],
    gapTags: [],
    misconceptionIDs: [],
    sourceRefs: [],
    reviewedAt: "2026-08-01T00:00:00.000Z"
  };
}

function progressWithEvents(reviewEvents: Record<string, unknown>[]) {
  return {
    schemaVersion: 2,
    topics: {},
    reviewEvents
  };
}
