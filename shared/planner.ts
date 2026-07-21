import { dueReviewItems } from "./domain";
import type { DueReviewItem, KnowledgeTopic, ProgressRecord } from "./types";

/** A date in the exam's local calendar, formatted as YYYY-MM-DD. */
export type PlannerDate = string;

/**
 * The inputs collected by the v1 exam-planning UI.  The resulting sessions are
 * projections only: callers own any persistence decision.
 */
export interface ExamPlanInput {
  examName: string;
  /** The exam's local calendar date. Sessions are never scheduled on this date. */
  targetDate: PlannerDate;
  topicIDs: string[];
  sessionCount: number;
  timeZone: string;
}

export interface PlannedReviewSession {
  date: PlannerDate;
  items: DueReviewItem[];
}

export interface ExamPlanProjection {
  examName: string;
  targetDate: PlannerDate;
  timeZone: string;
  topicIDs: string[];
  sessions: PlannedReviewSession[];
}

export interface PlanExamReviewsOptions {
  topics: KnowledgeTopic[];
  progress: ProgressRecord;
  /** Injected to make planning reproducible and testable. Defaults to the current instant. */
  now?: Date;
}

export const maxReviewItemsPerSession = 4;

/**
 * Returns exactly `sessionCount` local calendar dates from today through the
 * day before the exam. The exam date is deliberately exclusive.
 */
export function examSessionDates(input: Pick<ExamPlanInput, "targetDate" | "sessionCount" | "timeZone">, now = new Date()): PlannerDate[] {
  validateTimeZone(input.timeZone);
  validateSessionCount(input.sessionCount);
  const target = parsePlannerDate(input.targetDate, "targetDate");
  const today = localPlannerDate(now, input.timeZone);
  const todayDay = parsePlannerDate(today, "today");
  const availableDays = daysBetween(todayDay, target);

  if (availableDays <= 0) {
    throw new RangeError("targetDate must be after today in the selected time zone.");
  }
  if (input.sessionCount > availableDays) {
    throw new RangeError("sessionCount cannot exceed the number of calendar days before targetDate.");
  }
  if (input.sessionCount === 1) return [today];

  const finalSessionDay = availableDays - 1;
  return Array.from({ length: input.sessionCount }, (_, index) => {
    const offset = Math.round((index * finalSessionDay) / (input.sessionCount - 1));
    return formatPlannerDate(todayDay + offset);
  });
}

/**
 * Selects at most four runnable review items for each projected session.
 * It intentionally does not update card state or move due dates.
 */
export function planExamReviews(input: ExamPlanInput, options: PlanExamReviewsOptions): ExamPlanProjection {
  if (!input.examName.trim()) throw new Error("examName cannot be empty.");
  if (!input.topicIDs.length) throw new Error("topicIDs cannot be empty.");
  const uniqueTopicIDs = [...new Set(input.topicIDs)];
  if (uniqueTopicIDs.length !== input.topicIDs.length) throw new Error("topicIDs cannot contain duplicates.");

  const now = options.now ?? new Date();
  const dates = examSessionDates(input, now);
  const selectedTopicIDs = new Set(uniqueTopicIDs);
  const items = dueReviewItems({ topics: options.topics, progress: options.progress }, now)
    .filter((item) => selectedTopicIDs.has(item.topicID));
  const capacity = dates.length * maxReviewItemsPerSession;
  const plannedItems = items.slice(0, capacity);

  return {
    examName: input.examName.trim(),
    targetDate: input.targetDate,
    timeZone: input.timeZone,
    topicIDs: uniqueTopicIDs,
    sessions: dates.map((date, index) => ({
      date,
      items: plannedItems.slice(index * maxReviewItemsPerSession, (index + 1) * maxReviewItemsPerSession)
    }))
  };
}

export function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}.`);
  }
}

function validateSessionCount(sessionCount: number): void {
  if (!Number.isSafeInteger(sessionCount) || sessionCount < 1) {
    throw new RangeError("sessionCount must be a positive integer.");
  }
}

function localPlannerDate(now: Date, timeZone: string): PlannerDate {
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be a valid Date.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parsePlannerDate(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError(`${label} must be a real calendar date.`);
  }
  return Math.floor(timestamp / 86_400_000);
}

function daysBetween(startDay: number, endDay: number): number {
  return endDay - startDay;
}

function formatPlannerDate(day: number): PlannerDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
