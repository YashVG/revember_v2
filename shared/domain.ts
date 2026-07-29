import type {
  AnswerChoice,
  AppSnapshot,
  DueReviewItem,
  KnowledgeTopic,
  ProgressRecord,
  Question,
  QuestionKind,
  ReviewCardState,
  ReviewEvent,
  ReviewRating,
  TopicProgress,
  TransferLevel
} from "./types";
import {
  inferReviewRating,
  REVIEW_RESPONSE_TIME_CAP_MS
} from "./review-timing";

export const schedulerVersion = "simple-v1";
const minutesPerDay = 1_440;
const millisecondsPerDay = 86_400_000;

export function emptyProgress(): ProgressRecord {
  return { schemaVersion: 2, topics: {}, reviewEvents: [] };
}

export function emptyTopicProgress(): TopicProgress {
  return {
    attemptsByQuestionID: {},
    weakConceptIDs: {},
    reviewCardsByQuestionID: {}
  };
}

export function scheduleReview(
  previous: ReviewCardState | undefined,
  rating: ReviewRating,
  reviewedAt: string
): ReviewCardState {
  const intervalDays = intervalFor(previous, rating);
  const previousDifficulty = previous?.difficulty ?? 5;
  const difficultyDelta = { missed: 1, hard: 0.25, good: -0.25, easy: -1 }[rating];
  const difficulty = Math.min(10, Math.max(1, previousDifficulty + difficultyDelta));
  const reviewedDate = new Date(reviewedAt);

  return {
    schedulerVersion,
    questionRevision: previous?.questionRevision ?? 1,
    dueAt: new Date(reviewedDate.getTime() + intervalDays * millisecondsPerDay).toISOString(),
    intervalDays,
    stability: intervalDays,
    difficulty,
    lastRating: rating,
    lapses: (previous?.lapses ?? 0) + (rating === "missed" ? 1 : 0),
    reviews: (previous?.reviews ?? 0) + 1,
    lastReviewedAt: reviewedDate.toISOString()
  };
}

export function intervalFor(previous: ReviewCardState | undefined, rating: ReviewRating): number {
  if (!previous) {
    return { missed: 15 / minutesPerDay, hard: 1, good: 2, easy: 4 }[rating];
  }
  switch (rating) {
    case "missed": return 1;
    case "hard": return Math.max(1, previous.intervalDays * 1.2);
    case "good": return previous.intervalDays * 2.2;
    case "easy": return previous.intervalDays * 3;
  }
}

export function normalizeTopic(raw: unknown): KnowledgeTopic {
  if (!raw || typeof raw !== "object") throw new Error("Topic must be a JSON object.");
  const topic = raw as Partial<KnowledgeTopic>;
  if (!topic.id || !topic.title || !topic.summary) throw new Error("Topic requires id, title, and summary.");
  if (!Array.isArray(topic.concepts) || !Array.isArray(topic.gaps) || !Array.isArray(topic.questions)) {
    throw new Error("Topic requires concepts, gaps, and questions arrays.");
  }
  const normalized: KnowledgeTopic = {
    schemaVersion: topic.schemaVersion ?? 1,
    revision: topic.revision ?? 0,
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    sources: topic.sources ?? [],
    relationships: (topic.relationships ?? []).map((relationship) => ({ ...relationship, sourceRefs: relationship.sourceRefs ?? [] })),
    concepts: (topic.concepts ?? []).map((concept) => ({
      ...concept,
      relatedTerms: concept.relatedTerms ?? [],
      confusableTerms: concept.confusableTerms ?? [],
      gapTags: concept.gapTags ?? [],
      sourceRefs: concept.sourceRefs ?? []
    })),
    gaps: (topic.gaps ?? []).map((gap) => ({
      ...gap,
      conceptIDs: gap.conceptIDs ?? [],
      misconceptionIDs: gap.misconceptionIDs ?? [],
      sourceRefs: gap.sourceRefs ?? []
    })),
    questions: (topic.questions ?? []).map((question) => ({
      ...question,
      revision: question.revision ?? 1,
      kind: question.kind ?? "multipleChoice",
      transferLevel: question.transferLevel ?? "recall",
      conceptIDs: question.conceptIDs ?? [],
      gapTags: question.gapTags ?? [],
      sourceRefs: question.sourceRefs ?? [],
      choices: question.choices ?? []
    }))
  };
  validateTopic(normalized);
  return normalized;
}

export function validateTopic(topic: KnowledgeTopic, expectedID?: string): void {
  const issues: string[] = [];
  if (topic.schemaVersion < 1 || topic.schemaVersion > 2) issues.push(`unsupported schemaVersion ${topic.schemaVersion}`);
  if (topic.schemaVersion >= 2 && topic.revision < 1) issues.push("schema v2 requires a positive revision");
  if (expectedID && topic.id !== expectedID) issues.push(`topic id ${topic.id} must match ${expectedID}.json`);
  const sourceIDs = new Set(topic.sources.map((source) => source.id));
  const conceptIDs = new Set(topic.concepts.map((concept) => concept.id));
  checkUnique(topic.sources.map((source) => source.id), "source", issues);
  checkUnique(topic.relationships.map((relationship) => relationship.id), "relationship", issues);
  checkUnique(topic.concepts.map((concept) => concept.id), "concept", issues);
  checkUnique(topic.gaps.map((gap) => gap.id), "gap", issues);
  checkUnique(topic.questions.map((question) => question.id), "question", issues);
  for (const concept of topic.concepts) checkSourceRefs(concept.sourceRefs, `concept ${concept.id}`, sourceIDs, issues);
  for (const gap of topic.gaps) {
    for (const conceptID of gap.conceptIDs) if (!conceptIDs.has(conceptID)) issues.push(`gap ${gap.id} references missing concept ${conceptID}`);
    checkSourceRefs(gap.sourceRefs, `gap ${gap.id}`, sourceIDs, issues);
  }
  for (const question of topic.questions) {
    if (question.revision < 1) issues.push(`question ${question.id} requires a positive revision`);
    if (question.choices.length < 2 || question.choices.filter((choice) => choice.isCorrect).length !== 1) {
      issues.push(`question ${question.id} requires at least two choices and exactly one correct choice`);
    }
    checkUnique(question.choices.map((choice) => choice.id), `choice in question ${question.id}`, issues);
    for (const conceptID of question.conceptIDs) if (!conceptIDs.has(conceptID)) issues.push(`question ${question.id} references missing concept ${conceptID}`);
    checkSourceRefs(question.sourceRefs, `question ${question.id}`, sourceIDs, issues);
  }
  for (const relationship of topic.relationships) {
    if (!conceptIDs.has(relationship.sourceConceptID) || !conceptIDs.has(relationship.targetConceptID)) {
      issues.push(`relationship ${relationship.id} references a missing concept`);
    }
    checkSourceRefs(relationship.sourceRefs, `relationship ${relationship.id}`, sourceIDs, issues);
  }
  if (issues.length) throw new Error(issues.join("; "));
}

function checkSourceRefs(references: string[], owner: string, sourceIDs: Set<string>, issues: string[]): void {
  for (const sourceRef of references) if (!sourceIDs.has(sourceRef)) issues.push(`${owner} references missing source ${sourceRef}`);
}

function checkUnique(ids: string[], label: string, issues: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) issues.push(`${label} id cannot be empty`);
    else if (seen.has(id)) issues.push(`duplicate ${label} id ${id}`);
    seen.add(id);
  }
}

export function normalizeProgress(raw: unknown): ProgressRecord {
  const progress = recordValue(raw, "Progress");
  const schemaVersion = progress.schemaVersion === undefined
    ? 1
    : positiveInteger(progress.schemaVersion, "Progress schemaVersion");
  if (schemaVersion > 2) throw new Error(`Progress schema v${schemaVersion} is newer than this app supports.`);
  const topicRecords = optionalRecord(progress.topics, "Progress topics");
  const topics = Object.fromEntries(Object.entries(topicRecords).map(([topicID, value]) => {
    const topic = recordValue(value, `Progress topic ${topicID}`);
    const attempts = optionalRecord(topic.attemptsByQuestionID, `Progress topic ${topicID} attempts`);
    const attemptsByQuestionID = Object.fromEntries(Object.entries(attempts).map(([questionID, value]) => {
      const attempt = recordValue(value, `Progress attempt ${topicID}/${questionID}`);
      const lastAnsweredAt = optionalIsoTimestamp(attempt.lastAnsweredAt, `Progress attempt ${topicID}/${questionID} lastAnsweredAt`);
      return [questionID, {
        attempts: optionalNonNegativeInteger(attempt.attempts, `Progress attempt ${topicID}/${questionID} attempts`),
        correctAttempts: optionalNonNegativeInteger(attempt.correctAttempts, `Progress attempt ${topicID}/${questionID} correctAttempts`),
        ...(lastAnsweredAt ? { lastAnsweredAt } : {})
      }];
    }));
    const weakConcepts = optionalRecord(topic.weakConceptIDs, `Progress topic ${topicID} weak concepts`);
    const weakConceptIDs = Object.fromEntries(Object.entries(weakConcepts).map(([conceptID, value]) => [
      conceptID,
      nonNegativeInteger(value, `Progress weak concept ${topicID}/${conceptID}`)
    ]));
    const reviewCards = optionalRecord(topic.reviewCardsByQuestionID, `Progress topic ${topicID} review cards`);
    const reviewCardsByQuestionID = Object.fromEntries(Object.entries(reviewCards).map(([questionID, value]) => [
      questionID,
      normalizeReviewCard(value, topicID, questionID)
    ]));
    const lastReviewedAt = optionalIsoTimestamp(topic.lastReviewedAt, `Progress topic ${topicID} lastReviewedAt`);
    return [topicID, {
      attemptsByQuestionID,
      weakConceptIDs,
      ...(lastReviewedAt ? { lastReviewedAt } : {}),
      reviewCardsByQuestionID
    }];
  }));
  const rawReviewEvents = progress.reviewEvents ?? [];
  if (!Array.isArray(rawReviewEvents)) throw new Error("Progress reviewEvents must be an array.");
  const reviewEvents = rawReviewEvents.map((value, index) => normalizeReviewEvent(value, index));
  const reviewEventIDs = new Set<string>();
  for (const event of reviewEvents) {
    const normalizedID = event.id.toLowerCase();
    if (reviewEventIDs.has(normalizedID)) throw new Error(`Progress contains duplicate review event ID ${event.id}.`);
    reviewEventIDs.add(normalizedID);
  }
  return {
    schemaVersion,
    topics,
    reviewEvents
  };
}

const reviewEventKeys = new Set([
  "id",
  "topicID",
  "questionID",
  "questionRevision",
  "questionKind",
  "transferLevel",
  "questionPrompt",
  "choiceID",
  "selectedChoiceText",
  "correctChoiceID",
  "correctChoiceText",
  "isCorrect",
  "rating",
  "responseTimeMs",
  "ratingSource",
  "conceptIDs",
  "gapTags",
  "misconceptionIDs",
  "sourceRefs",
  "reviewedAt"
]);

function normalizeReviewEvent(raw: unknown, index: number): ReviewEvent {
  const label = `Progress review event ${index}`;
  const event = recordValue(raw, label);
  const questionKind = optionalQuestionKind(event.questionKind, `${label} questionKind`);
  const transferLevel = optionalTransferLevel(event.transferLevel, `${label} transferLevel`);
  const questionPrompt = optionalText(event.questionPrompt, `${label} questionPrompt`);
  const selectedChoiceText = optionalText(event.selectedChoiceText, `${label} selectedChoiceText`);
  const correctChoiceID = optionalNonEmptyString(event.correctChoiceID, `${label} correctChoiceID`);
  const correctChoiceText = optionalText(event.correctChoiceText, `${label} correctChoiceText`);
  const responseTimeMs = event.responseTimeMs === undefined
    ? undefined
    : nonNegativeInteger(event.responseTimeMs, `${label} responseTimeMs`);
  if (responseTimeMs !== undefined && responseTimeMs > REVIEW_RESPONSE_TIME_CAP_MS) {
    throw new Error(`${label} responseTimeMs must be at most ${REVIEW_RESPONSE_TIME_CAP_MS}.`);
  }
  if (event.ratingSource !== undefined && event.ratingSource !== "responseTime") {
    throw new Error(`${label} ratingSource is invalid.`);
  }
  if (typeof event.isCorrect !== "boolean") throw new Error(`${label} isCorrect must be a boolean.`);
  if (!isReviewRating(event.rating)) throw new Error(`${label} rating is invalid.`);
  if ((responseTimeMs === undefined) !== (event.ratingSource === undefined)) {
    throw new Error(`${label} responseTimeMs and ratingSource must be stored together.`);
  }
  if (responseTimeMs !== undefined && inferReviewRating(event.isCorrect, responseTimeMs) !== event.rating) {
    throw new Error(`${label} rating does not match its correctness and response time.`);
  }
  return {
    ...safeUnknownFields(event, reviewEventKeys, label),
    id: nonEmptyString(event.id, `${label} id`),
    topicID: nonEmptyString(event.topicID, `${label} topicID`),
    questionID: nonEmptyString(event.questionID, `${label} questionID`),
    questionRevision: event.questionRevision === undefined ? 1 : positiveInteger(event.questionRevision, `${label} questionRevision`),
    ...(questionKind ? { questionKind } : {}),
    ...(transferLevel ? { transferLevel } : {}),
    ...(questionPrompt !== undefined ? { questionPrompt } : {}),
    choiceID: nonEmptyString(event.choiceID, `${label} choiceID`),
    ...(selectedChoiceText !== undefined ? { selectedChoiceText } : {}),
    ...(correctChoiceID ? { correctChoiceID } : {}),
    ...(correctChoiceText !== undefined ? { correctChoiceText } : {}),
    isCorrect: event.isCorrect,
    rating: event.rating,
    ...(responseTimeMs === undefined ? {} : { responseTimeMs }),
    ...(event.ratingSource === "responseTime" ? { ratingSource: event.ratingSource } : {}),
    conceptIDs: optionalStringArray(event.conceptIDs, `${label} conceptIDs`),
    gapTags: optionalStringArray(event.gapTags, `${label} gapTags`),
    misconceptionIDs: optionalStringArray(event.misconceptionIDs, `${label} misconceptionIDs`),
    sourceRefs: optionalStringArray(event.sourceRefs, `${label} sourceRefs`),
    reviewedAt: isoTimestamp(event.reviewedAt, `${label} reviewedAt`)
  };
}

function normalizeReviewCard(raw: unknown, topicID: string, questionID: string): ReviewCardState {
  const label = `Progress review card ${topicID}/${questionID}`;
  const card = recordValue(raw, label);
  const cardSchedulerVersion = card.schedulerVersion ?? schedulerVersion;
  if (typeof cardSchedulerVersion !== "string" || !cardSchedulerVersion.trim()) {
    throw new Error(`${label} schedulerVersion must be a non-empty string.`);
  }
  const lastRating = card.lastRating;
  if (lastRating !== undefined && !isReviewRating(lastRating)) {
    throw new Error(`${label} lastRating is invalid.`);
  }
  const lastReviewedAt = optionalIsoTimestamp(card.lastReviewedAt, `${label} lastReviewedAt`);
  return {
    ...card,
    schedulerVersion: cardSchedulerVersion,
    questionRevision: card.questionRevision === undefined ? 1 : positiveInteger(card.questionRevision, `${label} questionRevision`),
    dueAt: isoTimestamp(card.dueAt, `${label} dueAt`),
    intervalDays: positiveFiniteNumber(card.intervalDays, `${label} intervalDays`),
    stability: nonNegativeFiniteNumber(card.stability, `${label} stability`),
    difficulty: boundedFiniteNumber(card.difficulty, 1, 10, `${label} difficulty`),
    ...(lastRating ? { lastRating } : {}),
    lapses: optionalNonNegativeInteger(card.lapses, `${label} lapses`),
    reviews: optionalNonNegativeInteger(card.reviews, `${label} reviews`),
    ...(lastReviewedAt ? { lastReviewedAt } : {})
  } as ReviewCardState;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  return value === undefined ? {} : recordValue(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number {
  return value === undefined ? 0 : nonNegativeInteger(value, label);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  if (value !== value.trim()) throw new Error(`${label} cannot start or end with whitespace.`);
  return value;
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return [...value];
}

function positiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return value;
}

function nonNegativeFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}

function boundedFiniteNumber(value: unknown, low: number, high: number, label: string): number {
  const number = nonNegativeFiniteNumber(value, label);
  if (number < low || number > high) throw new Error(`${label} must be between ${low} and ${high}.`);
  return number;
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  const timestamp = Date.parse(value);
  if (!match || !Number.isFinite(timestamp)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function optionalIsoTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : isoTimestamp(value, label);
}

function isReviewRating(value: unknown): value is ReviewRating {
  return value === "missed" || value === "hard" || value === "good" || value === "easy";
}

function optionalQuestionKind(value: unknown, label: string): QuestionKind | undefined {
  if (value === undefined) return undefined;
  if (value === "multipleChoice" || value === "freeRecall" || value === "explain" || value === "predict" ||
      value === "compare" || value === "trace" || value === "debug") return value;
  throw new Error(`${label} is invalid.`);
}

function optionalTransferLevel(value: unknown, label: string): TransferLevel | undefined {
  if (value === undefined) return undefined;
  if (value === "recall" || value === "application" || value === "transfer") return value;
  throw new Error(`${label} is invalid.`);
}

function safeUnknownFields(
  value: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
  label: string
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => {
    if (knownKeys.has(key)) return false;
    if (!isSafeJsonValue(item, new Set())) throw new Error(`${label} field ${key} must be JSON-safe.`);
    return true;
  }));
}

function isSafeJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const safe = Array.isArray(value)
    ? value.every((item) => isSafeJsonValue(item, ancestors))
    : Object.values(value).every((item) => isSafeJsonValue(item, ancestors));
  ancestors.delete(value);
  return safe;
}

export function dueReviewItems(snapshot: Pick<AppSnapshot, "topics" | "progress">, at = new Date()): DueReviewItem[] {
  const scheduled: DueReviewItem[] = [];
  const revised: DueReviewItem[] = [];
  const fresh: DueReviewItem[] = [];
  for (const topic of snapshot.topics) {
    for (const question of activeQuestions(topic)) {
      const state = snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID?.[question.id];
      const base = { id: `${topic.id}::${question.id}`, topicID: topic.id, questionID: question.id, topic, question };
      if (!state) fresh.push({ ...base, isNew: true, isRevised: false });
      else if (state.questionRevision !== question.revision) revised.push({ ...base, isNew: false, isRevised: true });
      else if (new Date(state.dueAt) <= at) scheduled.push({ ...base, dueAt: state.dueAt, isNew: false, isRevised: false });
    }
  }
  scheduled.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.id.localeCompare(b.id));
  revised.sort((a, b) => a.id.localeCompare(b.id));
  return [...scheduled, ...revised, ...fresh];
}

export function nextDueAt(snapshot: Pick<AppSnapshot, "topics" | "progress">): string | undefined {
  return snapshot.topics.flatMap((topic) => activeQuestions(topic).flatMap((question) => {
    const state = snapshot.progress.topics[topic.id]?.reviewCardsByQuestionID?.[question.id];
    return state?.questionRevision === question.revision ? [state.dueAt] : [];
  })).sort()[0];
}

export function activeQuestions(topic: KnowledgeTopic): Question[] {
  return topic.questions.filter((question) => !question.retiredAt);
}

export function correctChoice(question: Question): AnswerChoice | undefined {
  return question.choices.find((choice) => choice.isCorrect);
}

export function intervalLabel(state: ReviewCardState): string {
  if (state.intervalDays < 1) return `${Math.max(1, Math.round(state.intervalDays * minutesPerDay))} min interval`;
  const value = Number.isInteger(state.intervalDays) ? state.intervalDays.toFixed(0) : state.intervalDays.toFixed(1);
  return `${value} ${state.intervalDays === 1 ? "day" : "days"} interval`;
}

export function applyReviewEvent(progress: ProgressRecord, event: ReviewEvent): ReviewCardState {
  const existing = progress.reviewEvents.find((candidate) => candidate.id.toLowerCase() === event.id.toLowerCase());
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error(`Review event ID conflict: ${event.id}`);
    const state = progress.topics[event.topicID]?.reviewCardsByQuestionID?.[event.questionID];
    if (!state || state.questionRevision !== event.questionRevision) throw new Error("Stored review event has no matching current scheduler state.");
    return state;
  }

  progress.reviewEvents.push(event);
  const topicProgress = progress.topics[event.topicID] ?? emptyTopicProgress();
  const questionProgress = topicProgress.attemptsByQuestionID[event.questionID] ?? { attempts: 0, correctAttempts: 0 };
  questionProgress.attempts += 1;
  if (event.isCorrect) questionProgress.correctAttempts += 1;
  else for (const conceptID of event.conceptIDs) topicProgress.weakConceptIDs[conceptID] = (topicProgress.weakConceptIDs[conceptID] ?? 0) + 1;
  if (!questionProgress.lastAnsweredAt || questionProgress.lastAnsweredAt < event.reviewedAt) questionProgress.lastAnsweredAt = event.reviewedAt;
  if (!topicProgress.lastReviewedAt || topicProgress.lastReviewedAt < event.reviewedAt) topicProgress.lastReviewedAt = event.reviewedAt;
  topicProgress.attemptsByQuestionID[event.questionID] = questionProgress;

  const history = progress.reviewEvents
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.topicID === event.topicID && candidate.questionID === event.questionID && candidate.questionRevision === event.questionRevision)
    .sort((a, b) => a.candidate.reviewedAt.localeCompare(b.candidate.reviewedAt) || a.index - b.index)
    .map(({ candidate }) => candidate);
  let state: ReviewCardState | undefined;
  for (const historicalEvent of history) {
    state = scheduleReview(state, historicalEvent.isCorrect ? historicalEvent.rating : "missed", historicalEvent.reviewedAt);
    state.questionRevision = event.questionRevision;
  }
  if (!state) throw new Error("Could not derive the review schedule.");
  topicProgress.reviewCardsByQuestionID[event.questionID] = state;
  progress.topics[event.topicID] = topicProgress;
  progress.schemaVersion = 2;
  return state;
}
