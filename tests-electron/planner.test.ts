import { describe, expect, it } from "vitest";
import { examSessionDates, maxReviewItemsPerSession, planExamReviews, validateTimeZone } from "../shared/planner";
import type { KnowledgeTopic, ProgressRecord, Question, ReviewCardState } from "../shared/types";

const now = new Date("2026-02-27T12:00:00.000Z");

function question(id: string, revision = 1): Question {
  return {
    id, revision, kind: "multipleChoice", transferLevel: "recall", prompt: id,
    difficulty: "intro", conceptIDs: [], gapTags: [], sourceRefs: [], explanation: id,
    choices: [{ id: `${id}-yes`, text: "yes", isCorrect: true }, { id: `${id}-no`, text: "no", isCorrect: false }]
  };
}

function topic(id: string, questions: Question[]): KnowledgeTopic {
  return { schemaVersion: 2, revision: 1, id, title: id, summary: id, sources: [], relationships: [], concepts: [], gaps: [], questions };
}

function card(dueAt: string, questionRevision = 1): ReviewCardState {
  return { schedulerVersion: "simple-v1", questionRevision, dueAt, intervalDays: 1, stability: 1, difficulty: 5, lapses: 0, reviews: 1 };
}

function progress(cards: Record<string, Record<string, ReviewCardState>> = {}): ProgressRecord {
  return {
    schemaVersion: 2,
    topics: Object.fromEntries(Object.entries(cards).map(([topicID, reviewCardsByQuestionID]) => [topicID, {
      attemptsByQuestionID: {}, weakConceptIDs: {}, reviewCardsByQuestionID
    }])),
    reviewEvents: []
  };
}

describe("exam session dates", () => {
  it("is deterministic, keeps the target date exclusive, and crosses a month boundary", () => {
    const input = { targetDate: "2026-03-03", sessionCount: 4, timeZone: "UTC" };
    expect(examSessionDates(input, now)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(examSessionDates(input, now)).toEqual(examSessionDates(input, now));
  });

  it("handles leap days as ordinary calendar dates", () => {
    const leapNow = new Date("2028-02-28T12:00:00.000Z");
    expect(examSessionDates({ targetDate: "2028-03-02", sessionCount: 3, timeZone: "UTC" }, leapNow))
      .toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });

  it("uses the requested local calendar day through a DST boundary", () => {
    const dstNow = new Date("2026-03-08T07:30:00.000Z"); // 2026-03-07 in America/Los_Angeles
    expect(examSessionDates({ targetDate: "2026-03-10", sessionCount: 3, timeZone: "America/Los_Angeles" }, dstNow))
      .toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("rejects invalid zones, malformed/nonexistent dates, and targets that are today or past", () => {
    expect(() => validateTimeZone("Mars/Olympus_Mons")).toThrow("Invalid IANA time zone");
    expect(() => examSessionDates({ targetDate: "2026-02-30", sessionCount: 1, timeZone: "UTC" }, now)).toThrow("real calendar date");
    expect(() => examSessionDates({ targetDate: "2026-02-27", sessionCount: 1, timeZone: "UTC" }, now)).toThrow("after today");
    expect(() => examSessionDates({ targetDate: "2026-02-26", sessionCount: 1, timeZone: "UTC" }, now)).toThrow("after today");
  });
});

describe("exam review planning", () => {
  it("uses only selected topics, only runnable scheduled cards, and leaves dueAt unchanged", () => {
    const dueAt = "2026-02-27T11:59:59.000Z";
    const futureDueAt = "2026-02-27T12:00:01.000Z";
    const topics = [topic("selected", [question("due"), question("future"), question("new")]), topic("other", [question("other")])];
    const state = progress({ selected: { due: card(dueAt), future: card(futureDueAt) }, other: { other: card(dueAt) } });

    const plan = planExamReviews({ examName: "Midterm", targetDate: "2026-03-02", topicIDs: ["selected"], sessionCount: 1, timeZone: "UTC" }, { topics, progress: state, now });

    expect(plan.sessions[0].items.map((item) => item.questionID)).toEqual(["due", "new"]);
    expect(state.topics.selected.reviewCardsByQuestionID.due.dueAt).toBe(dueAt);
    expect(state.topics.selected.reviewCardsByQuestionID.future.dueAt).toBe(futureDueAt);
  });

  it("caps every session at four items and total selection at session capacity", () => {
    const topics = [topic("selected", Array.from({ length: 10 }, (_, index) => question(`q${index}`)))];
    const plan = planExamReviews({ examName: "Final", targetDate: "2026-03-03", topicIDs: ["selected"], sessionCount: 2, timeZone: "UTC" }, { topics, progress: progress(), now });

    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions.map((session) => session.items.length)).toEqual([4, 4]);
    expect(plan.sessions.flatMap((session) => session.items)).toHaveLength(8);
    expect(plan.sessions.every((session) => session.items.length <= maxReviewItemsPerSession)).toBe(true);
  });
});
