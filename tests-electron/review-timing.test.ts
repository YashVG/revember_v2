import { describe, expect, test } from "vitest";
import {
  inferReviewRating,
  normalizeResponseTimeMs,
  responseTimeLabel,
  reviewRatingLabel
} from "../shared/review-timing";

describe("automatic review timing", () => {
  test.each([
    [false, 250, "missed"],
    [false, 60_000, "missed"],
    [true, 0, "easy"],
    [true, 4_999, "easy"],
    [true, 5_000, "good"],
    [true, 10_000, "good"],
    [true, 10_001, "hard"],
    [true, 60_000, "hard"]
  ] as const)("maps correctness %s and %sms to %s", (isCorrect, elapsed, expected) => {
    expect(inferReviewRating(isCorrect, elapsed)).toBe(expected);
  });

  test.each([
    [-1, 0],
    [Number.NaN, 0],
    [1_234.6, 1_235],
    [90_000, 60_000]
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeResponseTimeMs(input)).toBe(expected);
  });

  test("uses learner-facing labels without changing the stored Good grade", () => {
    expect(reviewRatingLabel("good")).toBe("Medium");
    expect(reviewRatingLabel("easy")).toBe("Easy");
    expect(responseTimeLabel(4_850)).toBe("4.9s");
    expect(responseTimeLabel(12_400)).toBe("12s");
  });
});
