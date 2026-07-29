import type { Question, ReviewRating } from "../../../shared/types";

type ReviewQuestionIdentity = Pick<Question, "id" | "revision">;

export interface ReviewSubmissionIdentity {
  eventID: string;
  reviewedAt: string;
}

export function reviewQuestionKey(topicID: string, question: ReviewQuestionIdentity): string {
  return [topicID, question.id, String(question.revision)].map(encodeURIComponent).join(":");
}

export function reviewSubmissionKey(
  topicID: string,
  question: ReviewQuestionIdentity,
  choiceID: string,
  rating: ReviewRating,
  responseTimeMs?: number
): string {
  return `${reviewQuestionKey(topicID, question)}:${encodeURIComponent(choiceID)}:${rating}:${responseTimeMs ?? "manual"}`;
}

export function getOrCreateReviewSubmission(
  cache: Map<string, ReviewSubmissionIdentity>,
  submissionKey: string,
  createEventID: () => string = () => crypto.randomUUID(),
  createReviewedAt: () => string = () => new Date().toISOString()
): ReviewSubmissionIdentity {
  const existing = cache.get(submissionKey);
  if (existing) return existing;
  const submission = { eventID: createEventID(), reviewedAt: createReviewedAt() };
  cache.set(submissionKey, submission);
  return submission;
}
