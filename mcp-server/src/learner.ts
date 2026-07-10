import fs from "node:fs/promises";
import path from "node:path";
import type { RevemberConfig } from "./config.js";
import type { KnowledgeTopic } from "./schema.js";
import { listSessionSummaries } from "./sessions.js";
import { listTopicFiles, readTopic } from "./topics.js";

type JsonRecord = Record<string, unknown>;

interface NormalizedEvent {
  id?: string | undefined;
  topicID: string;
  cardID: string;
  questionRevision: number;
  choiceID?: string | undefined;
  isCorrect?: boolean | undefined;
  rating?: string | undefined;
  reviewedAt?: string | undefined;
  conceptIDs: string[];
  gapTags: string[];
  misconceptionIDs: string[];
  hasMisconceptionSnapshot: boolean;
}

interface CardEvidence {
  cardID: string;
  questionRevision: number;
  schedulerVersion?: string | undefined;
  attempts: number;
  staleAttempts: number;
  staleEvidence: boolean;
  correctAttempts: number;
  incorrectAttempts: number;
  accuracy?: number | undefined;
  lastReviewedAt?: string | undefined;
  dueAt?: string | undefined;
  due: boolean;
  rating?: string | undefined;
  lapses: number;
  reviews: number;
  intervalDays?: number | undefined;
  stability?: number | undefined;
  difficulty?: number | undefined;
  retired: boolean;
  misconceptionIDs: string[];
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function numberValue(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function questionRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function booleanValue(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => item !== undefined) : [];
}

function normalizeEvent(value: JsonRecord, fallbackTopicID?: string): NormalizedEvent | undefined {
  const topicID = stringValue(value.topicID, value.topicId, fallbackTopicID);
  const cardID = stringValue(value.questionID, value.cardID, value.questionId, value.cardId);
  if (!topicID || !cardID) return undefined;
  const directMisconception = stringValue(value.misconceptionID, value.misconceptionId);
  const misconceptionList = value.misconceptionIDs ?? value.misconceptionIds;
  return {
    id: stringValue(value.id),
    topicID,
    cardID,
    questionRevision: questionRevision(value.questionRevision),
    choiceID: stringValue(value.choiceID, value.choiceId, value.selectedChoiceID),
    isCorrect: booleanValue(value.isCorrect, value.correct),
    rating: stringValue(value.rating, value.effortRating),
    reviewedAt: stringValue(value.reviewedAt, value.answeredAt, value.occurredAt, value.timestamp),
    conceptIDs: strings(value.conceptIDs ?? value.conceptIds),
    gapTags: strings(value.gapTags),
    misconceptionIDs: [...new Set([
      ...strings(misconceptionList),
      ...(directMisconception ? [directMisconception] : [])
    ])],
    hasMisconceptionSnapshot: Array.isArray(misconceptionList) || directMisconception !== undefined
  };
}

function collectEvents(progress: JsonRecord): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const raw of [...arrayRecords(progress.reviewEvents), ...arrayRecords(progress.events)]) {
    const event = normalizeEvent(raw);
    if (event) events.push(event);
  }
  const topics = record(progress.topics) ?? {};
  for (const [topicID, topicValue] of Object.entries(topics)) {
    const topicProgress = record(topicValue);
    if (!topicProgress) continue;
    for (const raw of [...arrayRecords(topicProgress.reviewEvents), ...arrayRecords(topicProgress.events)]) {
      const event = normalizeEvent(raw, topicID);
      if (event) events.push(event);
    }
  }
  const seen = new Set<string>();
  return events.filter((event, index) => {
    const key = event.id ?? `${event.topicID}|${event.cardID}|${event.reviewedAt ?? ""}|${event.choiceID ?? ""}|${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function topicProgress(progress: JsonRecord, topicID: string): JsonRecord {
  return record(record(progress.topics)?.[topicID]) ?? {};
}

function cardSchedule(progress: JsonRecord, topicID: string, cardID: string): JsonRecord | undefined {
  const perTopic = topicProgress(progress, topicID);
  const exact = record(perTopic.reviewCardsByQuestionID)?.[cardID];
  if (record(exact)) return record(exact);
  for (const key of ["cardSchedules", "reviewCards", "questionSchedules"] as const) {
    const nested = record(perTopic[key])?.[cardID];
    if (record(nested)) return record(nested);
  }
  const topSchedules = progress.cardSchedules;
  const topRecord = record(topSchedules);
  if (topRecord) {
    const direct = topRecord[`${topicID}/${cardID}`] ?? topRecord[`${topicID}:${cardID}`];
    if (record(direct)) return record(direct);
    const nested = record(topRecord[topicID])?.[cardID];
    if (record(nested)) return record(nested);
  }
  for (const candidate of arrayRecords(topSchedules)) {
    if (stringValue(candidate.topicID) === topicID && stringValue(candidate.questionID, candidate.cardID) === cardID) {
      return candidate;
    }
  }
  return undefined;
}

function legacyCardProgress(progress: JsonRecord, topicID: string, cardID: string): JsonRecord | undefined {
  return record(record(topicProgress(progress, topicID).attemptsByQuestionID)?.[cardID]);
}

function isoMillis(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : undefined;
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => isoMillis(value) !== undefined)
    .sort((left, right) => (isoMillis(right) ?? 0) - (isoMillis(left) ?? 0))[0];
}

function evidenceForCard(
  topic: KnowledgeTopic,
  card: KnowledgeTopic["questions"][number],
  progress: JsonRecord,
  events: NormalizedEvent[],
  nowMillis: number
): CardEvidence {
  const authoredRevision = questionRevision(card.revision);
  const allCardEvents = events.filter((event) => event.topicID === topic.id && event.cardID === card.id);
  const cardEvents = allCardEvents.filter((event) => event.questionRevision === authoredRevision);
  const staleEvents = allCardEvents.filter((event) => event.questionRevision !== authoredRevision);
  const legacy = legacyCardProgress(progress, topic.id, card.id);
  const legacyRevision = questionRevision(legacy?.questionRevision);
  const legacyAttempts = numberValue(legacy?.attempts) ?? 0;
  const legacyCorrectAttempts = numberValue(legacy?.correctAttempts) ?? 0;
  const hasEventLedger = allCardEvents.length > 0;
  const legacyIsCurrent = !hasEventLedger && legacyRevision === authoredRevision;
  const attempts = hasEventLedger
    ? cardEvents.length
    : legacyIsCurrent ? legacyAttempts : 0;
  const correctAttempts = hasEventLedger
    ? cardEvents.filter((event) => event.isCorrect === true).length
    : legacyIsCurrent ? legacyCorrectAttempts : 0;
  const incorrectAttempts = hasEventLedger
    ? cardEvents.filter((event) => event.isCorrect === false).length
    : Math.max(0, attempts - correctAttempts);
  const staleAttempts = hasEventLedger
    ? staleEvents.length
    : legacyRevision !== authoredRevision ? legacyAttempts : 0;
  const storedSchedule = cardSchedule(progress, topic.id, card.id);
  const scheduleIsCurrent = storedSchedule !== undefined
    && questionRevision(storedSchedule.questionRevision) === authoredRevision;
  const schedule = scheduleIsCurrent ? storedSchedule : undefined;
  const dueAt = stringValue(schedule?.dueAt, schedule?.nextReviewAt);
  const misconceptionIDs = new Set<string>();
  for (const event of cardEvents) {
    for (const id of event.misconceptionIDs) misconceptionIDs.add(id);
    if (!event.hasMisconceptionSnapshot && event.isCorrect === false && event.choiceID) {
      const choice = card.choices.find((candidate) => candidate.id === event.choiceID);
      if (choice?.misconceptionID) misconceptionIDs.add(choice.misconceptionID);
    }
  }
  const lastEvent = [...cardEvents].sort(
    (left, right) => (isoMillis(right.reviewedAt) ?? 0) - (isoMillis(left.reviewedAt) ?? 0)
  )[0];
  const retired = card.retiredAt != null;
  const gradedAttempts = correctAttempts + incorrectAttempts;
  return {
    cardID: card.id,
    questionRevision: authoredRevision,
    schedulerVersion: stringValue(schedule?.schedulerVersion),
    attempts,
    staleAttempts,
    staleEvidence: staleAttempts > 0
      || (!hasEventLedger && legacy !== undefined && !legacyIsCurrent)
      || (storedSchedule !== undefined && !scheduleIsCurrent),
    correctAttempts,
    incorrectAttempts,
    accuracy: gradedAttempts > 0 ? correctAttempts / gradedAttempts : undefined,
    lastReviewedAt: latestTimestamp([
      lastEvent?.reviewedAt,
      stringValue(schedule?.lastReviewedAt),
      stringValue(legacyIsCurrent ? legacy?.lastAnsweredAt : undefined)
    ]),
    dueAt,
    due: !retired && dueAt !== undefined && (isoMillis(dueAt) ?? Number.POSITIVE_INFINITY) <= nowMillis,
    rating: stringValue(schedule?.lastRating, lastEvent?.rating),
    lapses: numberValue(schedule?.lapses) ?? 0,
    reviews: numberValue(schedule?.reviews) ?? attempts,
    intervalDays: numberValue(schedule?.intervalDays),
    stability: numberValue(schedule?.stability),
    difficulty: numberValue(schedule?.difficulty),
    retired,
    misconceptionIDs: [...misconceptionIDs].sort()
  };
}

function legacyWeakConceptIDs(progress: JsonRecord, topicID: string): string[] {
  const weak = topicProgress(progress, topicID).weakConceptIDs;
  if (Array.isArray(weak)) return strings(weak);
  return weak && typeof weak === "object" ? Object.keys(weak as JsonRecord) : [];
}

function buildTopicBrief(topic: KnowledgeTopic, progress: JsonRecord, events: NormalizedEvent[], nowMillis: number) {
  const cardEvidence = topic.questions.map((card) => evidenceForCard(topic, card, progress, events, nowMillis));
  const evidenceByID = new Map(cardEvidence.map((evidence) => [evidence.cardID, evidence]));
  const legacyWeak = new Set(legacyWeakConceptIDs(progress, topic.id));
  const eventCardIDs = new Set(
    events.filter((event) => event.topicID === topic.id).map((event) => event.cardID)
  );
  const concepts = topic.concepts.map((concept) => {
    const linked = topic.questions.filter((card) => card.conceptIDs.includes(concept.id));
    const evidence = linked.map((card) => evidenceByID.get(card.id)!).filter(Boolean);
    const attempts = evidence.reduce((sum, value) => sum + value.attempts, 0);
    const staleAttempts = evidence.reduce((sum, value) => sum + value.staleAttempts, 0);
    const correctAttempts = evidence.reduce((sum, value) => sum + value.correctAttempts, 0);
    const incorrectAttempts = evidence.reduce((sum, value) => sum + value.incorrectAttempts, 0);
    const lapses = evidence.reduce((sum, value) => sum + value.lapses, 0);
    const legacyWeakIsCurrent = linked.every((card) => questionRevision(card.revision) === 1)
      && linked.every((card) => !eventCardIDs.has(card.id));
    const gradedAttempts = correctAttempts + incorrectAttempts;
    const weak = (legacyWeakIsCurrent && legacyWeak.has(concept.id))
      || lapses > 0
      || (gradedAttempts > 0 && correctAttempts / gradedAttempts < 0.7);
    return {
      id: concept.id,
      title: concept.title,
      attempts,
      staleAttempts,
      correctAttempts,
      incorrectAttempts,
      accuracy: gradedAttempts > 0 ? correctAttempts / gradedAttempts : undefined,
      lastReviewedAt: latestTimestamp(evidence.map((value) => value.lastReviewedAt)),
      dueCards: evidence.filter((value) => value.due).length,
      untestedCards: evidence.filter((value) => !value.retired && value.attempts === 0).length,
      weak
    };
  });
  const weakConceptIDs = concepts.filter((concept) => concept.weak).map((concept) => concept.id);
  const misconceptions = new Set(cardEvidence.flatMap((evidence) => evidence.misconceptionIDs));
  const gaps = topic.gaps.map((gap) => {
    const relatedEvidence = topic.questions
      .filter((card) => card.conceptIDs.some((id) => gap.conceptIDs.includes(id)) || card.gapTags.includes(gap.tag))
      .map((card) => evidenceByID.get(card.id)!)
      .filter(Boolean);
    const hadMiss = relatedEvidence.some((evidence) => evidence.incorrectAttempts > 0 || evidence.lapses > 0);
    const latestCorrect = relatedEvidence.length > 0 && relatedEvidence.every((evidence) => {
      if (evidence.attempts === 0) return false;
      return evidence.accuracy !== undefined && evidence.accuracy >= 0.8;
    });
    const misconceptionMatch = (gap.misconceptionIDs ?? []).some((id) => misconceptions.has(id));
    const weakMatch = gap.conceptIDs.some((id) => weakConceptIDs.includes(id));
    return {
      id: gap.id,
      title: gap.title,
      status: misconceptionMatch || weakMatch ? "unresolved" : hadMiss && latestCorrect ? "repaired" : "unobserved",
      evidenceCardIDs: relatedEvidence.filter((evidence) => evidence.attempts > 0).map((evidence) => evidence.cardID)
    };
  });
  const attempts = cardEvidence.reduce((sum, evidence) => sum + evidence.attempts, 0);
  const staleAttempts = cardEvidence.reduce((sum, evidence) => sum + evidence.staleAttempts, 0);
  const correctAttempts = cardEvidence.reduce((sum, evidence) => sum + evidence.correctAttempts, 0);
  const incorrectAttempts = cardEvidence.reduce((sum, evidence) => sum + evidence.incorrectAttempts, 0);
  const gradedAttempts = correctAttempts + incorrectAttempts;
  return {
    id: topic.id,
    title: topic.title,
    revision: topic.revision ?? 0,
    authoredCards: topic.questions.length,
    activeCards: cardEvidence.filter((evidence) => !evidence.retired).length,
    dueCardIDs: cardEvidence.filter((evidence) => evidence.due).sort((left, right) => (isoMillis(left.dueAt) ?? 0) - (isoMillis(right.dueAt) ?? 0)).map((evidence) => evidence.cardID),
    untestedCardIDs: cardEvidence.filter((evidence) => !evidence.retired && evidence.attempts === 0).map((evidence) => evidence.cardID),
    attempts,
    staleAttempts,
    correctAttempts,
    incorrectAttempts,
    accuracy: gradedAttempts > 0 ? correctAttempts / gradedAttempts : undefined,
    lastReviewedAt: latestTimestamp(cardEvidence.map((evidence) => evidence.lastReviewedAt)),
    weakConceptIDs,
    misconceptionIDs: [...misconceptions].sort(),
    concepts,
    gaps,
    cards: cardEvidence
  };
}

export async function readProgressSnapshot(config: RevemberConfig): Promise<{ data: JsonRecord; exists: boolean; error?: string | undefined }> {
  try {
    const raw = await fs.readFile(config.progressPath, "utf8");
    const parsed = JSON.parse(raw);
    const data = record(parsed);
    if (!data) return { data: {}, exists: true, error: "Progress root must be a JSON object." };
    return { data, exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, exists: false };
    return { data: {}, exists: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getLearnerBrief(
  config: RevemberConfig,
  options: { topicID?: string | undefined; now?: string | undefined; includeRetired?: boolean | undefined } = {}
) {
  const progress = await readProgressSnapshot(config);
  const events = collectEvents(progress.data);
  const now = options.now ?? new Date().toISOString();
  const nowMillis = isoMillis(now);
  if (nowMillis === undefined) throw new Error(`Invalid now timestamp: ${now}`);
  const topics = [];
  for (const file of await listTopicFiles(config)) {
    const id = path.basename(file, ".json");
    if (options.topicID && id !== options.topicID) continue;
    try {
      const topic = await readTopic(config, id);
      const brief = buildTopicBrief(topic, progress.data, events, nowMillis);
      if (!options.includeRetired) brief.cards = brief.cards.filter((card) => !card.retired);
      topics.push(brief);
    } catch {
      continue;
    }
  }
  if (options.topicID && topics.length === 0) throw new Error(`Topic not found: ${options.topicID}.`);
  const sessions = (await listSessionSummaries(config))
    .filter((session) => session.valid && (!options.topicID || session.topicID === options.topicID))
    .sort((left, right) => (isoMillis(right.capturedAt) ?? 0) - (isoMillis(left.capturedAt) ?? 0))
    .slice(0, 10);
  const schemaVersion = numberValue(progress.data.schemaVersion);
  const schedulerVersions = [...new Set(
    topics.flatMap((topic) => topic.cards.map((card) => card.schedulerVersion).filter((version): version is string => version !== undefined))
  )].sort();
  return {
    generatedAt: now,
    knowledgeRoot: config.knowledgeRoot,
    progressPath: config.progressPath,
    progress: {
      exists: progress.exists,
      readable: progress.error === undefined,
      error: progress.error,
      schemaVersion,
      hasLegacyAttempts: topics.some((topic) => topic.cards.some((card) => legacyCardProgress(progress.data, topic.id, card.cardID) !== undefined)),
      reviewEventCount: events.length,
      hasV2Scheduler: Object.values(record(progress.data.topics) ?? {}).some((value) => record(record(value)?.reviewCardsByQuestionID) !== undefined),
      schedulerVersions
    },
    totals: {
      topics: topics.length,
      activeCards: topics.reduce((sum, topic) => sum + topic.activeCards, 0),
      dueCards: topics.reduce((sum, topic) => sum + topic.dueCardIDs.length, 0),
      untestedCards: topics.reduce((sum, topic) => sum + topic.untestedCardIDs.length, 0),
      attempts: topics.reduce((sum, topic) => sum + topic.attempts, 0),
      staleAttempts: topics.reduce((sum, topic) => sum + topic.staleAttempts, 0),
      unresolvedGaps: topics.reduce((sum, topic) => sum + topic.gaps.filter((gap) => gap.status === "unresolved").length, 0)
    },
    topics,
    recentSessions: sessions
  };
}
