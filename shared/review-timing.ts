import type { ReviewRating } from "./types";

export const REVIEW_EASY_MAX_MS = 5_000;
export const REVIEW_MEDIUM_MAX_MS = 10_000;
export const REVIEW_RESPONSE_TIME_CAP_MS = 60_000;

export function normalizeResponseTimeMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(REVIEW_RESPONSE_TIME_CAP_MS, Math.round(value));
}

export function inferReviewRating(isCorrect: boolean, responseTimeMs: number): ReviewRating {
  if (!isCorrect) return "missed";
  const elapsed = normalizeResponseTimeMs(responseTimeMs);
  if (elapsed < REVIEW_EASY_MAX_MS) return "easy";
  if (elapsed <= REVIEW_MEDIUM_MAX_MS) return "good";
  return "hard";
}

export function reviewRatingLabel(rating: ReviewRating): string {
  return rating === "good" ? "Medium" : `${rating[0].toUpperCase()}${rating.slice(1)}`;
}

export function responseTimeLabel(responseTimeMs: number): string {
  const elapsed = normalizeResponseTimeMs(responseTimeMs);
  if (elapsed < 10_000) return `${(Math.round(elapsed / 100) / 10).toFixed(1)}s`;
  return `${Math.round(elapsed / 1_000)}s`;
}
