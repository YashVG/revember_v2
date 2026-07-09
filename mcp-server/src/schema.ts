import { z } from "zod/v3";

const nonEmptyString = z.string().trim().min(1);
const safeSlugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const DifficultySchema = z.enum(["intro", "medium", "hard"]);

export const AnswerChoiceSchema = z
  .object({
    id: nonEmptyString,
    text: nonEmptyString,
    isCorrect: z.boolean()
  })
  .passthrough();

export const QuestionSchema = z
  .object({
    id: nonEmptyString,
    prompt: nonEmptyString,
    difficulty: DifficultySchema,
    conceptIDs: z.array(nonEmptyString),
    gapTags: z.array(nonEmptyString),
    choices: z.array(AnswerChoiceSchema).min(2),
    explanation: nonEmptyString
  })
  .passthrough();

export const ConceptSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    firstPrinciples: nonEmptyString,
    explanation: nonEmptyString,
    relatedTerms: z.array(nonEmptyString),
    confusableTerms: z.array(nonEmptyString),
    gapTags: z.array(nonEmptyString)
  })
  .passthrough();

export const GapSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    tag: nonEmptyString,
    description: nonEmptyString,
    conceptIDs: z.array(nonEmptyString)
  })
  .passthrough();

export const KnowledgeTopicSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    summary: nonEmptyString,
    concepts: z.array(ConceptSchema),
    gaps: z.array(GapSchema),
    questions: z.array(QuestionSchema)
  })
  .passthrough();

export type Difficulty = z.infer<typeof DifficultySchema>;
export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;

export interface TopicValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  topic?: KnowledgeTopic;
}

export interface TopicValidationOptions {
  expectedSlug?: string;
}

function pathLabel(pathParts: Array<string | number>): string {
  return pathParts.length === 0 ? "topic" : pathParts.join(".");
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return [...duplicates].sort();
}

export function normalizeTopicAlias(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };
  const maybeSlug = normalized.slug;

  if (typeof maybeSlug === "string" && normalized.id === undefined) {
    normalized.id = maybeSlug;
  }

  return normalized;
}

export function validateTopicData(data: unknown, options: TopicValidationOptions = {}): TopicValidationResult {
  const normalized = data && typeof data === "object" && !Array.isArray(data)
    ? normalizeTopicAlias(data as Record<string, unknown>)
    : data;

  const parsed = KnowledgeTopicSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${pathLabel(issue.path)}: ${issue.message}`),
      warnings: []
    };
  }

  const topic = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!safeSlugPattern.test(topic.id)) {
    errors.push(`Topic id "${topic.id}" must use only letters, numbers, underscores, and hyphens.`);
  }

  if (options.expectedSlug !== undefined && topic.id !== options.expectedSlug) {
    errors.push(`Topic id "${topic.id}" must match file slug "${options.expectedSlug}".`);
  }

  for (const id of duplicateValues(topic.concepts.map((concept) => concept.id))) {
    errors.push(`Duplicate concept id "${id}".`);
  }

  for (const id of duplicateValues(topic.gaps.map((gap) => gap.id))) {
    errors.push(`Duplicate gap id "${id}".`);
  }

  for (const id of duplicateValues(topic.questions.map((question) => question.id))) {
    errors.push(`Duplicate question id "${id}".`);
  }

  const conceptIDs = new Set(topic.concepts.map((concept) => concept.id));

  for (const gap of topic.gaps) {
    for (const conceptID of gap.conceptIDs) {
      if (!conceptIDs.has(conceptID)) {
        warnings.push(`Gap "${gap.id}" references missing concept "${conceptID}".`);
      }
    }
  }

  for (const question of topic.questions) {
    const correctChoices = question.choices.filter((choice) => choice.isCorrect);
    if (correctChoices.length !== 1) {
      errors.push(`Question "${question.id}" must have exactly one correct choice.`);
    }

    for (const id of duplicateValues(question.choices.map((choice) => choice.id))) {
      errors.push(`Question "${question.id}" has duplicate choice id "${id}".`);
    }

    for (const conceptID of question.conceptIDs) {
      if (!conceptIDs.has(conceptID)) {
        warnings.push(`Question "${question.id}" references missing concept "${conceptID}".`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topic
  };
}

export const TopicSchemaDocumentation = {
  description: "Revember v2 topic JSON schema used by the SwiftUI app.",
  notes: [
    "The app currently keys topics by id. MCP tools accept slug as an input alias and write id.",
    "Unknown top-level fields are preserved by the MCP server and ignored by Swift Codable.",
    "Markdown explanations are stored separately in notes/<id>.md."
  ],
  requiredShape: {
    id: "string",
    title: "string",
    summary: "string",
    concepts: [
      {
        id: "string",
        title: "string",
        firstPrinciples: "string",
        explanation: "string",
        relatedTerms: ["string"],
        confusableTerms: ["string"],
        gapTags: ["string"]
      }
    ],
    gaps: [
      {
        id: "string",
        title: "string",
        tag: "string",
        description: "string",
        conceptIDs: ["string"]
      }
    ],
    questions: [
      {
        id: "string",
        prompt: "string",
        difficulty: "intro|medium|hard",
        conceptIDs: ["string"],
        gapTags: ["string"],
        choices: [
          {
            id: "string",
            text: "string",
            isCorrect: "boolean"
          }
        ],
        explanation: "string"
      }
    ]
  }
};
