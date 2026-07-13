import type {
  AnswerChoice,
  AppSnapshot,
  DueReviewItem,
  KnowledgeTopic,
  ProgressRecord,
  Question,
  ReviewCardState,
  ReviewEvent,
  ReviewRating,
  TopicProgress
} from "./types";

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
  if (!raw || typeof raw !== "object") throw new Error("Progress must be a JSON object.");
  const progress = raw as Partial<ProgressRecord>;
  const schemaVersion = progress.schemaVersion ?? 1;
  if (schemaVersion > 2) throw new Error(`Progress schema v${schemaVersion} is newer than this app supports.`);
  const topics = Object.fromEntries(Object.entries(progress.topics ?? {}).map(([topicID, value]) => {
    const topic = value as Partial<TopicProgress>;
    const attemptsByQuestionID = Object.fromEntries(Object.entries(topic.attemptsByQuestionID ?? {}).map(([questionID, attempt]) => [questionID, {
      attempts: attempt.attempts ?? 0,
      correctAttempts: attempt.correctAttempts ?? 0,
      ...(attempt.lastAnsweredAt ? { lastAnsweredAt: attempt.lastAnsweredAt } : {})
    }]));
    const reviewCardsByQuestionID = Object.fromEntries(Object.entries(topic.reviewCardsByQuestionID ?? {}).map(([questionID, card]) => [questionID, {
      ...card,
      schedulerVersion: card.schedulerVersion ?? schedulerVersion,
      questionRevision: card.questionRevision ?? 1,
      lapses: card.lapses ?? 0,
      reviews: card.reviews ?? 0
    }]));
    return [topicID, {
      attemptsByQuestionID,
      weakConceptIDs: topic.weakConceptIDs ?? {},
      ...(topic.lastReviewedAt ? { lastReviewedAt: topic.lastReviewedAt } : {}),
      reviewCardsByQuestionID
    }];
  }));
  const reviewEvents = (progress.reviewEvents ?? []).map((event) => ({
    ...event,
    questionRevision: event.questionRevision ?? 1,
    conceptIDs: event.conceptIDs ?? [],
    gapTags: event.gapTags ?? [],
    misconceptionIDs: event.misconceptionIDs ?? [],
    sourceRefs: event.sourceRefs ?? []
  }));
  return {
    schemaVersion,
    topics,
    reviewEvents
  };
}

export function currentEvidence(topic: KnowledgeTopic, progress: ProgressRecord): { attempts: number; correct: number; score: number } {
  let attempts = 0;
  let correct = 0;
  for (const question of activeQuestions(topic)) {
    const events = progress.reviewEvents.filter((event) =>
      event.topicID === topic.id && event.questionID === question.id && event.questionRevision === question.revision
    );
    if (events.length) {
      attempts += events.length;
      correct += events.filter((event) => event.isCorrect).length;
    } else if (question.revision === 1) {
      const legacy = progress.topics[topic.id]?.attemptsByQuestionID?.[question.id];
      if (legacy) {
        attempts += legacy.attempts;
        correct += legacy.correctAttempts;
      }
    }
  }
  return { attempts, correct, score: attempts ? correct / attempts : 0 };
}

export function progressSummary(topic: KnowledgeTopic, progress: ProgressRecord): string {
  const evidence = currentEvidence(topic, progress);
  return evidence.attempts ? `${Math.round(evidence.score * 100)}% across ${evidence.attempts} current answers` : "No check-ins yet";
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

export function weakConceptIDs(topic: KnowledgeTopic, progress: ProgressRecord): string[] {
  const status = new Map<string, "fragile" | "developing" | "stable" | "untested">();
  for (const concept of topic.concepts) {
    const linked = activeQuestions(topic).filter((question) => question.conceptIDs.includes(concept.id));
    const tested = linked.flatMap((question) => {
      const events = progress.reviewEvents.filter((event) =>
        event.topicID === topic.id && event.questionID === question.id && event.questionRevision === question.revision
      );
      const latest = events.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt)).at(-1);
      if (!latest) return [];
      if (!latest.isCorrect || latest.rating === "missed") return ["fragile" as const];
      if (latest.rating === "hard") return ["developing" as const];
      return ["stable" as const];
    });
    status.set(concept.id, tested.includes("fragile") ? "fragile" : tested.includes("developing") ? "developing" : tested.length ? "stable" : "untested");
  }
  const evidenceBacked = topic.concepts.filter((concept) => ["fragile", "developing"].includes(status.get(concept.id) ?? ""));
  if (evidenceBacked.length) return evidenceBacked.map((concept) => concept.id);
  return Object.entries(progress.topics[topic.id]?.weakConceptIDs ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id)
    .filter((id) => topic.concepts.some((concept) => concept.id === id));
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
