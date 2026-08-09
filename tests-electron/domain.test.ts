import { describe, expect, test } from "vitest";
import {
  applyReviewEvent,
  dueReviewItems,
  emptyProgress,
  intervalFor,
  nextDueAt,
  normalizeProgress,
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

  test("validates and preserves immutable schedule-decision evidence", () => {
    const progress = normalizeProgress(progressWithEvents([{
      ...validReviewEvent(),
      scheduleDecision: {
        ...validScheduleDecision(),
        extension: { triggerPolicy: "amount-v0" }
      }
    }]));

    expect(progress.reviewEvents[0].scheduleDecision).toMatchObject({
      id: "schedule-event",
      sourceReviewEventID: "event",
      decidedAt: "2026-08-01T00:00:00.000Z",
      reason: "first-review",
      extension: { triggerPolicy: "amount-v0" },
      result: {
        schedulerVersion: "simple-v1",
        dueAt: "2026-08-03T00:00:00.000Z",
        reviews: 1
      }
    });
  });

  test.each([
    ["a non-derived ID", { id: "schedule-wrong" }, /id must be derived/i],
    ["a mismatched source event", { sourceReviewEventID: "other" }, /must match its review event/i],
    ["a decision time before its outcome", { decidedAt: "2026-07-31T23:59:59.000Z" }, /cannot predate/i],
    ["an invalid reason", { reason: "timer" }, /reason is invalid/i],
    ["a previous decision without a previous event", { previousScheduleDecisionID: "schedule-old" }, /requires previousReviewEventID/i]
  ])("rejects schedule decisions with %s", (_name, replacement, message) => {
    expect(() => normalizeProgress(progressWithEvents([{
      ...validReviewEvent(),
      scheduleDecision: { ...validScheduleDecision(), ...replacement }
    }]))).toThrow(message);
  });

  test("rejects a schedule decision whose result does not match its parent outcome", () => {
    expect(() => normalizeProgress(progressWithEvents([{
      ...validReviewEvent(),
      scheduleDecision: {
        ...validScheduleDecision(),
        result: { ...validScheduleDecision().result, questionRevision: 2 }
      }
    }]))).toThrow(/result questionRevision must match/i);
  });

  test("rejects a schedule decision result that does not match scheduler replay", () => {
    expect(() => normalizeProgress(progressWithEvents([{
      ...validReviewEvent(),
      scheduleDecision: {
        ...validScheduleDecision(),
        result: { ...validScheduleDecision().result, intervalDays: 99 }
      }
    }]))).toThrow(/result does not match scheduler replay/i);
  });

  test("rejects a decision recorded after the next outcome in the same revision", () => {
    const secondReviewedAt = "2026-08-03T00:00:00.000Z";
    const firstState = scheduleReview(undefined, "good", validReviewEvent().reviewedAt as string);
    const secondState = scheduleReview(firstState, "good", secondReviewedAt);
    expect(() => normalizeProgress(progressWithEvents([
      {
        ...validReviewEvent(),
        scheduleDecision: {
          ...validScheduleDecision(),
          decidedAt: "2026-08-03T00:00:01.000Z"
        }
      },
      {
        ...validReviewEvent(),
        id: "event-2",
        reviewedAt: secondReviewedAt,
        scheduleDecision: {
          schemaVersion: 1,
          id: "schedule-event-2",
          sourceReviewEventID: "event-2",
          previousReviewEventID: "event",
          previousScheduleDecisionID: "schedule-event",
          decidedAt: secondReviewedAt,
          reason: "review",
          result: secondState
        }
      }
    ]))).toThrow(/cannot postdate the next review outcome/i);
  });

  test("rejects a decision recorded after the next revision's outcome", () => {
    const nextReviewedAt = "2026-08-02T00:00:00.000Z";
    const revisedState = scheduleReview(undefined, "good", nextReviewedAt);
    revisedState.questionRevision = 2;
    expect(() => normalizeProgress(progressWithEvents([
      {
        ...validReviewEvent(),
        scheduleDecision: {
          ...validScheduleDecision(),
          decidedAt: "2026-08-02T00:00:01.000Z"
        }
      },
      {
        ...validReviewEvent(),
        id: "event-revision-2",
        questionRevision: 2,
        reviewedAt: nextReviewedAt,
        scheduleDecision: {
          schemaVersion: 1,
          id: "schedule-event-revision-2",
          sourceReviewEventID: "event-revision-2",
          decidedAt: nextReviewedAt,
          reason: "revision-reset",
          result: revisedState
        }
      }
    ]))).toThrow(/cannot postdate the next review outcome/i);
  });

  test("rejects a newer question revision that predates an older revision", () => {
    const revisedReviewedAt = "2026-08-01T00:00:00.000Z";
    const originalReviewedAt = "2026-08-02T00:00:00.000Z";
    const revisedState = scheduleReview(undefined, "good", revisedReviewedAt);
    revisedState.questionRevision = 2;
    const originalState = scheduleReview(undefined, "good", originalReviewedAt);
    expect(() => normalizeProgress(progressWithEvents([
      {
        ...validReviewEvent(),
        id: "event-revision-2",
        questionRevision: 2,
        reviewedAt: revisedReviewedAt,
        scheduleDecision: {
          schemaVersion: 1,
          id: "schedule-event-revision-2",
          sourceReviewEventID: "event-revision-2",
          decidedAt: revisedReviewedAt,
          reason: "revision-reset",
          result: revisedState
        }
      },
      {
        ...validReviewEvent(),
        reviewedAt: originalReviewedAt,
        scheduleDecision: {
          ...validScheduleDecision(),
          decidedAt: originalReviewedAt,
          result: originalState
        }
      }
    ]))).toThrow(/question revisions must not move backward/i);
  });

  test("rejects a current card that omits its newest schedule-decision link", () => {
    const decision = validScheduleDecision();
    expect(() => normalizeProgress({
      schemaVersion: 2,
      topics: {
        bits: {
          attemptsByQuestionID: {},
          weakConceptIDs: {},
          reviewCardsByQuestionID: { q1: decision.result }
        }
      },
      reviewEvents: [{ ...validReviewEvent(), scheduleDecision: decision }]
    })).toThrow(/invalid scheduleDecisionID/i);
  });

  test.each([
    ["numeric ID", { id: 17 }, /id must be a non-empty string/],
    ["invalid rating", { rating: "perfect" }, /rating is invalid/],
    ["invalid timestamp", { reviewedAt: "2026-02-30T00:00:00.000Z" }, /reviewedAt must be an ISO timestamp/],
    ["non-string array member", { conceptIDs: ["bit", 17] }, /conceptIDs must be an array of strings/],
    ["invalid question kind", { questionKind: "essay" }, /questionKind is invalid/],
    ["fractional response time", { responseTimeMs: 1.5 }, /responseTimeMs must be a non-negative integer/],
    ["excessive response time", { responseTimeMs: 60_001 }, /responseTimeMs must be at most 60000/],
    ["invalid rating source", { ratingSource: "guess" }, /ratingSource is invalid/],
    ["response time without a source", { responseTimeMs: 5_000 }, /responseTimeMs and ratingSource must be stored together/],
    ["source without a response time", { ratingSource: "responseTime" }, /responseTimeMs and ratingSource must be stored together/],
    ["inconsistent automatic rating", { responseTimeMs: 12_000, ratingSource: "responseTime", rating: "easy" }, /rating does not match/i]
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

function validScheduleDecision() {
  return {
    schemaVersion: 1,
    id: "schedule-event",
    sourceReviewEventID: "event",
    decidedAt: "2026-08-01T00:00:00.000Z",
    reason: "first-review",
    result: {
      schedulerVersion: "simple-v1",
      questionRevision: 1,
      dueAt: "2026-08-03T00:00:00.000Z",
      intervalDays: 2,
      stability: 2,
      difficulty: 4.75,
      lastRating: "good",
      lapses: 0,
      reviews: 1,
      lastReviewedAt: "2026-08-01T00:00:00.000Z"
    }
  };
}

function progressWithEvents(reviewEvents: Record<string, unknown>[]) {
  return {
    schemaVersion: 2,
    topics: {},
    reviewEvents
  };
}
