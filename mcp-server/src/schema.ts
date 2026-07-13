import { z } from "zod/v3";

const nonEmptyString = z.string().trim().min(1);
const safeSlugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const CurrentTopicSchemaVersion = 2;

export const DifficultySchema = z.enum(["intro", "medium", "hard"]);
export const ProbeKindSchema = z.enum([
  "multipleChoice",
  "freeRecall",
  "explain",
  "predict",
  "compare",
  "trace",
  "debug"
]);
export const TransferLevelSchema = z.enum(["recall", "application", "transfer"]);
export const ISODateTimeSchema = z.string().datetime({ offset: true });

export const SourceSchema = z.object({
  id: nonEmptyString,
  kind: nonEmptyString,
  title: nonEmptyString,
  locator: nonEmptyString.optional(),
  fingerprint: nonEmptyString.optional(),
  capturedAt: ISODateTimeSchema.optional()
}).passthrough();

export const RelationshipSchema = z.object({
  id: nonEmptyString,
  sourceConceptID: nonEmptyString,
  targetConceptID: nonEmptyString,
  kind: z.enum(["prerequisite", "partOf", "contrastsWith", "enables"]),
  rationale: nonEmptyString,
  sourceRefs: z.array(nonEmptyString)
}).passthrough();

export const AnswerChoiceSchema = z
  .object({
    id: nonEmptyString,
    text: nonEmptyString,
    isCorrect: z.boolean(),
    rationale: nonEmptyString.optional(),
    misconceptionID: nonEmptyString.optional()
  })
  .passthrough();

export const QuestionSchema = z
  .object({
    id: nonEmptyString,
    revision: z.number().int().positive().optional(),
    prompt: nonEmptyString,
    difficulty: DifficultySchema,
    conceptIDs: z.array(nonEmptyString),
    gapTags: z.array(nonEmptyString),
    choices: z.array(AnswerChoiceSchema).min(2),
    explanation: nonEmptyString,
    kind: ProbeKindSchema.optional(),
    transferLevel: TransferLevelSchema.optional(),
    sourceRefs: z.array(nonEmptyString).optional(),
    retiredAt: ISODateTimeSchema.nullable().optional()
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
    gapTags: z.array(nonEmptyString),
    sourceRefs: z.array(nonEmptyString).optional()
  })
  .passthrough();

export const GapSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    tag: nonEmptyString,
    description: nonEmptyString,
    conceptIDs: z.array(nonEmptyString),
    misconceptionIDs: z.array(nonEmptyString).optional(),
    sourceRefs: z.array(nonEmptyString).optional()
  })
  .passthrough();

export const KnowledgeTopicSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    summary: nonEmptyString,
    schemaVersion: z.number().int().positive().optional(),
    revision: z.number().int().nonnegative().optional(),
    sources: z.array(SourceSchema).optional(),
    relationships: z.array(RelationshipSchema).optional(),
    concepts: z.array(ConceptSchema),
    gaps: z.array(GapSchema),
    questions: z.array(QuestionSchema)
  })
  .passthrough();

export const LearningSessionSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: nonEmptyString,
  revision: z.number().int().positive(),
  capturedAt: ISODateTimeSchema,
  title: nonEmptyString,
  summary: nonEmptyString,
  topicID: nonEmptyString.optional(),
  topicRevision: z.number().int().nonnegative().optional(),
  confirmedConceptIDs: z.array(nonEmptyString),
  misconceptionIDs: z.array(nonEmptyString),
  openQuestions: z.array(nonEmptyString),
  sourceRefs: z.array(nonEmptyString),
  notesMarkdown: nonEmptyString.optional()
}).passthrough();

export type Difficulty = z.infer<typeof DifficultySchema>;
export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;
export type LearningSession = z.infer<typeof LearningSessionSchema>;

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

function sourceID(source: z.infer<typeof SourceSchema>): string {
  return source.id;
}

function collectSourceRefs(topic: KnowledgeTopic): Array<{ owner: string; refs: string[] }> {
  const refs: Array<{ owner: string; refs: string[] }> = [];
  for (const concept of topic.concepts) {
    if (concept.sourceRefs) refs.push({ owner: `Concept "${concept.id}"`, refs: concept.sourceRefs });
  }
  for (const gap of topic.gaps) {
    if (gap.sourceRefs) refs.push({ owner: `Gap "${gap.id}"`, refs: gap.sourceRefs });
  }
  for (const question of topic.questions) {
    if (question.sourceRefs) refs.push({ owner: `Question "${question.id}"`, refs: question.sourceRefs });
  }
  for (const relationship of topic.relationships ?? []) {
    if (relationship.sourceRefs) {
      refs.push({ owner: `Relationship "${relationship.id}"`, refs: relationship.sourceRefs });
    }
  }
  return refs;
}

export function normalizeTopicAlias(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };
  if (typeof normalized.slug === "string" && normalized.id === undefined) {
    normalized.id = normalized.slug;
  }

  if (Array.isArray(normalized.sources)) {
    normalized.sources = normalized.sources.map((value) => {
      if (typeof value === "string") {
        return { id: value, kind: "reference", title: value, locator: value };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const source = value as Record<string, unknown>;
      const { uri, citation, ...canonical } = source;
      return {
        ...canonical,
        kind: typeof source.kind === "string" ? source.kind : "reference",
        title: typeof source.title === "string"
          ? source.title
          : typeof citation === "string" ? citation : String(source.id ?? "source"),
        ...(canonical.locator === undefined && typeof uri === "string" ? { locator: uri } : {})
      };
    });
  }

  if (Array.isArray(normalized.relationships)) {
    normalized.relationships = normalized.relationships.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const relationship = value as Record<string, unknown>;
      const {
        fromConceptID,
        toConceptID,
        description,
        ...canonical
      } = relationship;
      const sourceConceptID = relationship.sourceConceptID ?? fromConceptID;
      const targetConceptID = relationship.targetConceptID ?? toConceptID;
      const rawKind = relationship.kind;
      const kindAliases: Record<string, string> = {
        "depends-on": "prerequisite",
        "contrasts-with": "contrastsWith"
      };
      const kind = typeof rawKind === "string" ? (kindAliases[rawKind] ?? rawKind) : rawKind;
      return {
        ...canonical,
        id: relationship.id ?? `${String(sourceConceptID)}-${String(kind)}-${String(targetConceptID)}`,
        sourceConceptID,
        targetConceptID,
        kind,
        rationale: relationship.rationale ?? description ?? String(kind ?? "relationship"),
        sourceRefs: Array.isArray(relationship.sourceRefs) ? relationship.sourceRefs : []
      };
    });
  }

  if (Array.isArray(normalized.questions)) {
    normalized.questions = normalized.questions.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const question = value as Record<string, unknown>;
      const kindAliases: Record<string, string> = {
        "multiple-choice": "multipleChoice",
        "free-recall": "freeRecall",
        "prediction": "predict",
        "compare-contrast": "compare",
        "debugging": "debug",
        "code-tracing": "trace",
        "explain-why": "explain"
      };
      const rawKind = typeof question.kind === "string" ? question.kind : "multipleChoice";
      const rawTransferLevel = typeof question.transferLevel === "string" ? question.transferLevel : "recall";
      return {
        ...question,
        revision: question.revision ?? 1,
        kind: kindAliases[rawKind] ?? rawKind,
        transferLevel: rawTransferLevel === "understanding" ? "application" : rawTransferLevel,
        sourceRefs: Array.isArray(question.sourceRefs) ? question.sourceRefs : []
      };
    });
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
  const schemaVersion = topic.schemaVersion ?? 1;
  if (schemaVersion < 1 || schemaVersion > CurrentTopicSchemaVersion) {
    errors.push(`schemaVersion ${schemaVersion} is unsupported; supported versions are 1...${CurrentTopicSchemaVersion}.`);
  }
  if (schemaVersion >= 2 && (topic.revision === undefined || topic.revision < 1)) {
    errors.push("Schema v2 topics require a positive revision.");
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
  for (const id of duplicateValues((topic.relationships ?? []).map((relationship) => relationship.id))) {
    errors.push(`Duplicate relationship id "${id}".`);
  }
  for (const id of duplicateValues((topic.sources ?? []).map(sourceID))) {
    errors.push(`Duplicate source id "${id}".`);
  }

  const conceptIDs = new Set(topic.concepts.map((concept) => concept.id));
  for (const gap of topic.gaps) {
    for (const conceptID of gap.conceptIDs) {
      if (!conceptIDs.has(conceptID)) {
        errors.push(`Gap "${gap.id}" references missing concept "${conceptID}".`);
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
        errors.push(`Question "${question.id}" references missing concept "${conceptID}".`);
      }
    }
  }

  for (const relationship of topic.relationships ?? []) {
    if (!conceptIDs.has(relationship.sourceConceptID)) {
      errors.push(`Relationship references missing source concept "${relationship.sourceConceptID}".`);
    }
    if (!conceptIDs.has(relationship.targetConceptID)) {
      errors.push(`Relationship references missing target concept "${relationship.targetConceptID}".`);
    }
    if (relationship.sourceConceptID === relationship.targetConceptID) {
      warnings.push(`Relationship "${relationship.id}" points a concept to itself.`);
    }
  }

  const sourceIDs = new Set((topic.sources ?? []).map(sourceID));
  for (const entry of collectSourceRefs(topic)) {
    for (const ref of entry.refs) {
      if (!sourceIDs.has(ref)) errors.push(`${entry.owner} references unknown source "${ref}".`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, topic };
}

export const TopicSchemaDocumentation = {
  description: "Revember topic schema. Legacy app topics remain valid; MCP mutations emit schema v2 revisions.",
  notes: [
    "The app keys topics by id. MCP tools accept slug as an input alias and write id.",
    "schemaVersion, revision, sources, relationships, and probe metadata are additive and backward-compatible.",
    "Questions remain in the questions array so the Electron app and MCP server share one canonical contract; MCP calls them cards or probes.",
    "Markdown explanations are stored separately in notes/<id>.md. Learning checkpoints are stored in sessions/<id>.json."
  ],
  additiveV2Shape: {
    schemaVersion: 2,
    revision: "monotonic integer",
    sources: [{ id: "string", kind: "string", title: "string", locator: "string?", fingerprint: "string?", capturedAt: "ISO-8601 timestamp?" }],
    relationships: [{ id: "string", sourceConceptID: "string", targetConceptID: "string", kind: "prerequisite|partOf|contrastsWith|enables", rationale: "string", sourceRefs: ["source-id"] }],
    questionProbeFields: {
      revision: "positive integer",
      kind: "multipleChoice|freeRecall|explain|predict|compare|trace|debug",
      transferLevel: "recall|application|transfer",
      sourceRefs: ["source-id"],
      retiredAt: "ISO-8601 timestamp or null",
      choiceAdditions: { rationale: "string?", misconceptionID: "string?" }
    }
  },
  requiredLegacyShape: {
    id: "string",
    title: "string",
    summary: "string",
    concepts: [{ id: "string", title: "string", firstPrinciples: "string", explanation: "string", relatedTerms: ["string"], confusableTerms: ["string"], gapTags: ["string"] }],
    gaps: [{ id: "string", title: "string", tag: "string", description: "string", conceptIDs: ["string"] }],
    questions: [{ id: "string", prompt: "string", difficulty: "intro|medium|hard", conceptIDs: ["string"], gapTags: ["string"], choices: [{ id: "string", text: "string", isCorrect: "boolean" }], explanation: "string" }]
  }
};
