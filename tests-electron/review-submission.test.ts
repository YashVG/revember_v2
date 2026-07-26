import { describe, expect, test } from "vitest";
import {
  getOrCreateReviewSubmission,
  reviewQuestionKey,
  reviewSubmissionKey
} from "../src/renderer/src/reviewSubmission";

describe("review submission identity", () => {
  const question = { id: "question:1", revision: 2 };

  test("is stable for an identical retry", () => {
    expect(reviewSubmissionKey("topic:1", question, "choice:1", "good"))
      .toBe(reviewSubmissionKey("topic:1", question, "choice:1", "good"));
  });

  test("changes whenever the persisted answer payload changes", () => {
    const original = reviewSubmissionKey("topic:1", question, "choice:1", "good");
    expect(reviewSubmissionKey("topic:1", question, "choice:1", "easy")).not.toBe(original);
    expect(reviewSubmissionKey("topic:1", question, "choice:2", "good")).not.toBe(original);
    expect(reviewSubmissionKey("topic:1", { ...question, revision: 3 }, "choice:1", "good")).not.toBe(original);
  });

  test("escapes IDs so delimiter characters cannot collide", () => {
    expect(reviewQuestionKey("topic:a", { id: "b", revision: 1 }))
      .not.toBe(reviewQuestionKey("topic", { id: "a:b", revision: 1 }));
  });

  test("retries with the exact same event ID and review timestamp", () => {
    const cache = new Map();
    const key = reviewSubmissionKey("topic:1", question, "choice:1", "good");
    const first = getOrCreateReviewSubmission(
      cache,
      key,
      () => "event-1",
      () => "2026-07-26T16:00:00.000Z"
    );
    const retry = getOrCreateReviewSubmission(
      cache,
      key,
      () => "event-should-not-be-created",
      () => "2026-07-26T17:00:00.000Z"
    );

    expect(retry).toBe(first);
    expect(retry).toEqual({
      eventID: "event-1",
      reviewedAt: "2026-07-26T16:00:00.000Z"
    });
  });

  test("changed answer payload gets a fresh event ID and timestamp", () => {
    const cache = new Map();
    const originalKey = reviewSubmissionKey("topic:1", question, "choice:1", "good");
    const changedKey = reviewSubmissionKey("topic:1", question, "choice:1", "easy");
    const original = getOrCreateReviewSubmission(
      cache,
      originalKey,
      () => "event-1",
      () => "2026-07-26T16:00:00.000Z"
    );
    const changed = getOrCreateReviewSubmission(
      cache,
      changedKey,
      () => "event-2",
      () => "2026-07-26T16:01:00.000Z"
    );

    expect(changed).not.toBe(original);
    expect(changed).toEqual({
      eventID: "event-2",
      reviewedAt: "2026-07-26T16:01:00.000Z"
    });
  });
});
