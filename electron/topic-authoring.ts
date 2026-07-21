import path from "node:path";
import { mutateTopicJson, type TopicFileLockOptions, type TopicMutationResult } from "../topic-authoring/index.js";
import { normalizeTopic, validateTopic } from "../shared/domain";
import type { CreateCardInput, EditCardInput, QuestionDraft, QuestionEdit, RetireCardInput } from "../shared/types";

const safeID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const questionKinds = new Set(["multipleChoice", "freeRecall", "explain", "predict", "compare", "trace", "debug"]);
const transferLevels = new Set(["recall", "application", "transfer"]);
const difficulties = new Set(["intro", "medium", "hard"]);

export interface ElectronTopicMutationInput {
  knowledgeRootPath: string;
  topicID: string;
  expectedRevision?: number;
  transform: (topic: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  lock?: TopicFileLockOptions;
}

/**
 * Safe main-process adapter for future topic-authoring IPC handlers.
 * The raw JSON object is transformed and written so passthrough metadata is not
 * discarded by the renderer-facing normalized topic model.
 */
export function mutateElectronTopic(input: ElectronTopicMutationInput): Promise<TopicMutationResult> {
  const topicPath = path.join(input.knowledgeRootPath, "topics", `${input.topicID}.json`);
  return mutateTopicJson({
    knowledgeRoot: input.knowledgeRootPath,
    topicPath,
    topicID: input.topicID,
    expectedRevision: input.expectedRevision,
    transform: input.transform,
    validate: (rawTopic) => {
      const normalized = normalizeTopic(rawTopic);
      validateTopic(normalized, input.topicID);
    },
    ...(input.lock ? { lock: input.lock } : {})
  });
}

export async function createTopicCard(knowledgeRootPath: string, rawInput: unknown): Promise<TopicMutationResult> {
  const input = parseCreateCardInput(rawInput);
  return await mutateElectronTopic({
    knowledgeRootPath,
    topicID: input.topicID,
    expectedRevision: input.expectedTopicRevision,
    transform: (topic) => {
      const questions = recordArray(topic.questions, "topic questions");
      if (questions.some((question) => question.id === input.card.id)) {
        throw new Error(`Question ${input.card.id} already exists in topic ${input.topicID}.`);
      }
      assertCardReferences(topic, input.card);
      return { ...topic, questions: [...questions, { ...input.card, revision: 1 }] };
    }
  });
}

export async function editTopicCard(knowledgeRootPath: string, rawInput: unknown): Promise<TopicMutationResult> {
  const input = parseEditCardInput(rawInput);
  return await mutateElectronTopic({
    knowledgeRootPath,
    topicID: input.topicID,
    expectedRevision: input.expectedTopicRevision,
    transform: (topic) => {
      let found = false;
      const questions = recordArray(topic.questions, "topic questions").map((question) => {
        if (question.id !== input.questionID) return question;
        found = true;
        const revision = positiveInteger(question.revision, `question ${input.questionID} revision`);
        if (revision !== input.expectedQuestionRevision) {
          throw new Error(`Question revision conflict for ${input.questionID}: expected ${input.expectedQuestionRevision}, found ${revision}.`);
        }
        if (typeof question.retiredAt === "string") throw new Error(`Question ${input.questionID} is retired and cannot be edited.`);
        assertCardReferences(topic, input.card);
        const existingChoices = recordArray(question.choices, `question ${input.questionID} choices`);
        assertStableChoiceIDs(existingChoices, input.card.choices, input.questionID);
        const existingByID = new Map(existingChoices.map((choice) => [String(choice.id), choice]));
        const choices = input.card.choices.map((choice) => replaceKnownChoiceFields(existingByID.get(choice.id)!, choice));
        return { ...question, ...input.card, choices, id: input.questionID, revision: revision + 1 };
      });
      if (!found) throw new Error(`Question ${input.questionID} does not exist in topic ${input.topicID}.`);
      return { ...topic, questions };
    }
  });
}

export async function retireTopicCard(knowledgeRootPath: string, rawInput: unknown, now = new Date()): Promise<TopicMutationResult> {
  const input = parseRetireCardInput(rawInput);
  if (Number.isNaN(now.getTime())) throw new Error("Retirement timestamp is invalid.");
  return await mutateElectronTopic({
    knowledgeRootPath,
    topicID: input.topicID,
    expectedRevision: input.expectedTopicRevision,
    transform: (topic) => {
      let found = false;
      const questions = recordArray(topic.questions, "topic questions").map((question) => {
        if (question.id !== input.questionID) return question;
        found = true;
        const revision = positiveInteger(question.revision, `question ${input.questionID} revision`);
        if (revision !== input.expectedQuestionRevision) {
          throw new Error(`Question revision conflict for ${input.questionID}: expected ${input.expectedQuestionRevision}, found ${revision}.`);
        }
        if (typeof question.retiredAt === "string") throw new Error(`Question ${input.questionID} is already retired.`);
        return { ...question, revision: revision + 1, retiredAt: now.toISOString() };
      });
      if (!found) throw new Error(`Question ${input.questionID} does not exist in topic ${input.topicID}.`);
      return { ...topic, questions };
    }
  });
}

function parseCreateCardInput(value: unknown): CreateCardInput {
  const input = record(value, "Create card input");
  return {
    topicID: identifier(input.topicID, "topicID"),
    expectedTopicRevision: nonNegativeInteger(input.expectedTopicRevision, "expectedTopicRevision"),
    card: parseQuestionDraft(input.card, true) as QuestionDraft
  };
}

function parseEditCardInput(value: unknown): EditCardInput {
  const input = record(value, "Edit card input");
  return {
    topicID: identifier(input.topicID, "topicID"),
    expectedTopicRevision: nonNegativeInteger(input.expectedTopicRevision, "expectedTopicRevision"),
    questionID: nonEmptyString(input.questionID, "questionID"),
    expectedQuestionRevision: positiveInteger(input.expectedQuestionRevision, "expectedQuestionRevision"),
    card: parseQuestionDraft(input.card, false) as QuestionEdit
  };
}

function parseRetireCardInput(value: unknown): RetireCardInput {
  const input = record(value, "Retire card input");
  return {
    topicID: identifier(input.topicID, "topicID"),
    expectedTopicRevision: nonNegativeInteger(input.expectedTopicRevision, "expectedTopicRevision"),
    questionID: nonEmptyString(input.questionID, "questionID"),
    expectedQuestionRevision: positiveInteger(input.expectedQuestionRevision, "expectedQuestionRevision")
  };
}

function parseQuestionDraft(value: unknown, includeID: boolean): QuestionDraft | QuestionEdit {
  const draft = record(value, "Card");
  const choices = array(draft.choices, "Card choices").map((choice, index) => parseChoice(choice, index));
  if (choices.length < 2 || choices.length > 4 || choices.filter((choice) => choice.isCorrect).length !== 1) {
    throw new Error("A card requires two to four choices and exactly one correct choice.");
  }
  const choiceIDs = choices.map((choice) => choice.id);
  if (new Set(choiceIDs).size !== choiceIDs.length) throw new Error("Card choice IDs must be unique.");
  const result: QuestionEdit & { id?: string } = {
    kind: oneOf(draft.kind, questionKinds, "card kind") as QuestionEdit["kind"],
    transferLevel: oneOf(draft.transferLevel, transferLevels, "card transferLevel") as QuestionEdit["transferLevel"],
    prompt: nonEmptyString(draft.prompt, "card prompt"),
    difficulty: oneOf(draft.difficulty, difficulties, "card difficulty") as QuestionEdit["difficulty"],
    conceptIDs: stringValues(draft.conceptIDs, "card conceptIDs"),
    gapTags: stringValues(draft.gapTags, "card gapTags"),
    sourceRefs: stringValues(draft.sourceRefs, "card sourceRefs"),
    choices,
    explanation: nonEmptyString(draft.explanation, "card explanation")
  };
  if (includeID) result.id = nonEmptyString(draft.id, "card id");
  return result as QuestionDraft | QuestionEdit;
}

function parseChoice(value: unknown, index: number) {
  const choice = record(value, `Choice ${index + 1}`);
  const parsed = {
    id: nonEmptyString(choice.id, `choice ${index + 1} id`),
    text: nonEmptyString(choice.text, `choice ${index + 1} text`),
    isCorrect: booleanValue(choice.isCorrect, `choice ${index + 1} isCorrect`),
    ...(choice.rationale === undefined ? {} : { rationale: nonEmptyString(choice.rationale, `choice ${index + 1} rationale`) }),
    ...(choice.misconceptionID === undefined ? {} : { misconceptionID: nonEmptyString(choice.misconceptionID, `choice ${index + 1} misconceptionID`) })
  };
  return parsed;
}

function replaceKnownChoiceFields(existing: Record<string, unknown>, next: QuestionEdit["choices"][number]): Record<string, unknown> {
  const merged = { ...existing, ...next };
  if (next.rationale === undefined) delete merged.rationale;
  if (next.misconceptionID === undefined) delete merged.misconceptionID;
  return merged;
}

function assertStableChoiceIDs(existing: Record<string, unknown>[], next: QuestionEdit["choices"], questionID: string): void {
  const previous = new Set(existing.map((choice) => nonEmptyString(choice.id, `existing choice in ${questionID}`)));
  const incoming = new Set(next.map((choice) => choice.id));
  if (previous.size !== incoming.size || [...previous].some((id) => !incoming.has(id))) {
    throw new Error(`Editing question ${questionID} must preserve all existing choice IDs.`);
  }
}

function assertCardReferences(topic: Record<string, unknown>, card: QuestionDraft | QuestionEdit): void {
  const conceptIDs = new Set(recordArray(topic.concepts, "topic concepts").map((concept) => nonEmptyString(concept.id, "concept id")));
  const sourceIDs = new Set(recordArray(topic.sources ?? [], "topic sources").map((source) => nonEmptyString(source.id, "source id")));
  for (const conceptID of card.conceptIDs) {
    if (!conceptIDs.has(conceptID)) throw new Error(`Card references missing concept ${conceptID}.`);
  }
  for (const sourceRef of card.sourceRefs) {
    if (!sourceIDs.has(sourceRef)) throw new Error(`Card references missing source ${sourceRef}.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  return array(value, label).map((item) => record(item, label));
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const id = nonEmptyString(value, label);
  if (value !== id) throw new Error(`${label} cannot start or end with whitespace.`);
  if (!safeID.test(id)) throw new Error(`${label} must contain only letters, numbers, hyphens, and underscores.`);
  return id;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function stringValues(value: unknown, label: string): string[] {
  const values = array(value, label).map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${label} cannot contain duplicates.`);
  return values;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function oneOf(value: unknown, allowed: Set<string>, label: string): string {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${label} is invalid.`);
  return value;
}
