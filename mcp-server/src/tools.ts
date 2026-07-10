import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import type { RevemberConfig } from "./config.js";
import {
  createTopic,
  listTopicFiles,
  readTopic,
  retireCard,
  updateTopic,
  updateMarkdownWithRevision,
  upsertCard,
  upsertConcept,
  validateTopicFile,
} from "./topics.js";
import { validateTopicData } from "./schema.js";
import { searchKnowledge, searchTopics } from "./search.js";
import { captureLearningSession } from "./sessions.js";
import { getLearnerBrief } from "./learner.js";
import { validateKnowledgeBase } from "./validation.js";

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use only letters, numbers, underscores, and hyphens.");

const difficultySchema = z.enum(["intro", "medium", "hard"]);
const expectedRevisionSchema = z.number().int().nonnegative().optional();
const probeKindSchema = z.enum([
  "multipleChoice",
  "freeRecall",
  "explain",
  "predict",
  "compare",
  "trace",
  "debug",
  "multiple-choice",
  "free-recall",
  "prediction",
  "compare-contrast",
  "debugging",
  "code-tracing",
  "explain-why"
]);
const transferLevelSchema = z.enum(["recall", "application", "transfer", "understanding"]);

const answerChoiceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  isCorrect: z.boolean(),
  rationale: z.string().min(1).optional(),
  misconceptionID: z.string().min(1).optional()
}).passthrough();

const knowledgeSourceInputSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  locator: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional()
}).passthrough();

const knowledgeRelationshipInputSchema = z.object({
  id: z.string().min(1),
  sourceConceptID: z.string().min(1),
  targetConceptID: z.string().min(1),
  kind: z.enum(["prerequisite", "partOf", "contrastsWith", "enables"]),
  rationale: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).optional()
}).passthrough();

const conceptCheckInputSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2),
  answerIndex: z.number().int().nonnegative(),
  explanation: z.string().min(1),
  difficulty: difficultySchema.optional()
});

const createConceptInputSchema = z.object({
  id: slugSchema.optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  firstPrinciples: z.string().optional(),
  explanation: z.string().optional(),
  relatedTerms: z.array(z.string()).optional(),
  confusableTerms: z.array(z.string()).optional(),
  gapTags: z.array(z.string()).optional(),
  difficulty: difficultySchema.optional(),
  checks: z.array(conceptCheckInputSchema).optional()
});

const conceptPatchSchema = z.object({
  id: slugSchema,
  title: z.string().min(1).optional(),
  firstPrinciples: z.string().min(1).optional(),
  explanation: z.string().min(1).optional(),
  relatedTerms: z.array(z.string().min(1)).optional(),
  confusableTerms: z.array(z.string().min(1)).optional(),
  gapTags: z.array(z.string().min(1)).optional(),
  sourceRefs: z.array(z.string().min(1)).optional()
}).passthrough();

const cardPatchSchema = z.object({
  id: slugSchema,
  prompt: z.string().min(1).optional(),
  difficulty: difficultySchema.optional(),
  conceptIDs: z.array(z.string().min(1)).optional(),
  gapTags: z.array(z.string().min(1)).optional(),
  choices: z.array(answerChoiceSchema).min(2).optional(),
  explanation: z.string().min(1).optional(),
  kind: probeKindSchema.optional(),
  transferLevel: transferLevelSchema.optional(),
  sourceRefs: z.array(z.string().min(1)).optional(),
  retiredAt: z.string().datetime({ offset: true }).nullable().optional()
}).passthrough();

function asTextResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`
      }
    ]
  };
}

function asErrorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

async function toolResult(callback: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return asTextResult(await callback());
  } catch (error) {
    return asErrorResult(error);
  }
}

interface ReviewPlanCandidate {
  id: string;
  title: string;
  questionCount: number;
  attempts: number;
  score: number;
  weakConceptIDs: string[];
  focusConcepts: string[];
  dueCardIDs: string[];
  untestedCardIDs: string[];
  revisedCardIDs: string[];
  staleAttempts: number;
}

function compareReviewPlanCandidates(left: ReviewPlanCandidate, right: ReviewPlanCandidate): number {
  if (left.dueCardIDs.length !== right.dueCardIDs.length) {
    return right.dueCardIDs.length - left.dueCardIDs.length;
  }
  if (left.untestedCardIDs.length !== right.untestedCardIDs.length) {
    return right.untestedCardIDs.length - left.untestedCardIDs.length;
  }
  if (left.weakConceptIDs.length !== right.weakConceptIDs.length) {
    return right.weakConceptIDs.length - left.weakConceptIDs.length;
  }
  if (left.attempts !== right.attempts) {
    return left.attempts - right.attempts;
  }
  if (left.score !== right.score) {
    return left.score - right.score;
  }
  return left.id.localeCompare(right.id);
}

function reviewPlanReason(topic: ReviewPlanCandidate): string {
  if (topic.dueCardIDs.length > 0) {
    return `${topic.dueCardIDs.length} current card${topic.dueCardIDs.length === 1 ? " is" : "s are"} due now: ${topic.dueCardIDs.join(", ")}.`;
  }
  if (topic.revisedCardIDs.length > 0) {
    return `${topic.revisedCardIDs.length} revised card${topic.revisedCardIDs.length === 1 ? " needs" : "s need"} fresh retrieval evidence.`;
  }
  if (topic.untestedCardIDs.length > 0) {
    return `${topic.untestedCardIDs.length} current card${topic.untestedCardIDs.length === 1 ? " has" : "s have"} no retrieval evidence yet.`;
  }
  if (topic.attempts === 0) {
    return "No recorded retrieval attempts yet.";
  }
  return `Current revision evidence is ${Math.round(topic.score * 100)}% across ${topic.attempts} attempts.`;
}

function reviewPlanSteps(topic: ReviewPlanCandidate): string[] {
  const targetCardIDs = topic.dueCardIDs.length > 0 ? topic.dueCardIDs : topic.untestedCardIDs;
  const targetCount = Math.min(targetCardIDs.length, 5);
  const targetText = topic.dueCardIDs.length > 0 ? "due" : "fresh";

  return [
    `Review ${topic.focusConcepts.slice(0, 3).join(", ") || "the core concepts"}.`,
    targetCount > 0
      ? `Answer ${targetCount} ${targetText} checkpoint question${targetCount === 1 ? "" : "s"}.`
      : `Answer ${Math.min(topic.questionCount, 5)} checkpoint question${Math.min(topic.questionCount, 5) === 1 ? "" : "s"}.`,
    topic.weakConceptIDs.length > 0
      ? `Revisit weak concept IDs: ${topic.weakConceptIDs.slice(0, 5).join(", ")}.`
      : "Write down one confusion to add back into the Markdown note."
  ];
}

export async function buildReviewPlan(
  config: RevemberConfig,
  maxTopics: number,
  includeProgress: boolean,
  now?: string
) {
  const topics: ReviewPlanCandidate[] = [];

  if (includeProgress) {
    const learnerBrief = await getLearnerBrief(config, now ? { now } : {});
    for (const topic of learnerBrief.topics) {
      const activeCards = topic.cards.filter((card) => !card.retired);
      const weakTitles = topic.concepts
        .filter((concept) => topic.weakConceptIDs.includes(concept.id))
        .map((concept) => concept.title);
      const remainingTitles = topic.concepts
        .filter((concept) => !topic.weakConceptIDs.includes(concept.id))
        .map((concept) => concept.title);

      topics.push({
        id: topic.id,
        title: topic.title,
        questionCount: topic.activeCards,
        attempts: topic.attempts,
        score: topic.accuracy ?? 0,
        weakConceptIDs: topic.weakConceptIDs,
        focusConcepts: [...weakTitles, ...remainingTitles],
        dueCardIDs: topic.dueCardIDs,
        untestedCardIDs: topic.untestedCardIDs,
        revisedCardIDs: activeCards
          .filter((card) => card.staleEvidence && card.attempts === 0)
          .map((card) => card.cardID),
        staleAttempts: topic.staleAttempts
      });
    }
  } else {
    for (const file of await listTopicFiles(config)) {
      const slug = path.basename(file, ".json");
      if (!slug) continue;

      try {
        const topic = await readTopic(config, slug);
        const activeQuestions = topic.questions.filter((question) => question.retiredAt == null);
        topics.push({
          id: topic.id,
          title: topic.title,
          questionCount: activeQuestions.length,
          attempts: 0,
          score: 0,
          weakConceptIDs: [],
          focusConcepts: topic.concepts.map((concept) => concept.title),
          dueCardIDs: [],
          untestedCardIDs: activeQuestions.map((question) => question.id),
          revisedCardIDs: [],
          staleAttempts: 0
        });
      } catch {
        continue;
      }
    }
  }

  const selected = topics.sort(compareReviewPlanCandidates).slice(0, maxTopics);
  return {
    knowledgeRoot: config.knowledgeRoot,
    progressPath: includeProgress ? config.progressPath : undefined,
    plan: selected.map((topic) => ({
      topic: `${topic.title} (${topic.id})`,
      reason: reviewPlanReason(topic),
      dueCardIDs: topic.dueCardIDs,
      untestedCardIDs: topic.untestedCardIDs,
      revisedCardIDs: topic.revisedCardIDs,
      staleAttempts: topic.staleAttempts,
      steps: reviewPlanSteps(topic)
    }))
  };
}

export function registerTools(server: McpServer, config: RevemberConfig): void {
  server.registerTool(
    "create_topic",
    {
      title: "Create Revember topic",
      description: "Create a new app-readable topic JSON file, and optionally its Markdown explanation.",
      inputSchema: {
        slug: slugSchema,
        title: z.string().min(1),
        summary: z.string().min(1),
        tags: z.array(z.string()).optional(),
        concepts: z.array(createConceptInputSchema).min(1),
        markdownBody: z.string().optional(),
        sources: z.array(knowledgeSourceInputSchema).optional(),
        relationships: z.array(knowledgeRelationshipInputSchema).optional(),
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => createTopic(config, args))
  );

  server.registerTool(
    "update_topic",
    {
      title: "Update Revember topic JSON",
      description: "Patch an existing topic JSON file, preserving fields not present in the patch.",
      inputSchema: {
        slug: slugSchema,
        patch: z.record(z.unknown()),
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => updateTopic(config, args.slug, args.patch, args.expectedRevision))
  );

  server.registerTool(
    "upsert_concept",
    {
      title: "Upsert Revember concept",
      description: "Create or patch one concept and atomically advance the topic revision.",
      inputSchema: {
        slug: slugSchema,
        concept: conceptPatchSchema,
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => upsertConcept(config, args.slug, args.concept, args.expectedRevision))
  );

  server.registerTool(
    "upsert_card",
    {
      title: "Upsert Revember card/probe",
      description: "Create or patch one question card/probe, including diagnostic rationale and misconception metadata.",
      inputSchema: {
        slug: slugSchema,
        card: cardPatchSchema,
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => upsertCard(config, args.slug, args.card, args.expectedRevision))
  );

  server.registerTool(
    "retire_card",
    {
      title: "Retire Revember card/probe",
      description: "Set a card's retiredAt timestamp without deleting historical review evidence.",
      inputSchema: {
        slug: slugSchema,
        cardID: slugSchema,
        retiredAt: z.string().datetime({ offset: true }).optional(),
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => retireCard(
      config,
      args.slug,
      args.cardID,
      args.retiredAt ?? new Date().toISOString(),
      args.expectedRevision
    ))
  );

  server.registerTool(
    "update_markdown_explanation",
    {
      title: "Update Revember Markdown explanation",
      description: "Replace or append the Markdown explanation for a topic in RevemberKnowledge/notes.",
      inputSchema: {
        slug: slugSchema,
        body: z.string().min(1),
        mode: z.enum(["replace", "append"]).optional(),
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => updateMarkdownWithRevision(
      config,
      args.slug,
      args.body,
      args.mode ?? "replace",
      args.expectedRevision
    ))
  );

  server.registerTool(
    "capture_learning_session",
    {
      title: "Capture Revember learning session",
      description: "Transactionally store a learning checkpoint under sessions/, optionally append its topic note, and advance the topic revision.",
      inputSchema: {
        id: slugSchema,
        capturedAt: z.string().datetime({ offset: true }).optional(),
        title: z.string().min(1),
        summary: z.string().min(1),
        topicID: slugSchema.optional(),
        confirmedConceptIDs: z.array(z.string().min(1)).optional(),
        misconceptionIDs: z.array(z.string().min(1)).optional(),
        openQuestions: z.array(z.string().min(1)).optional(),
        sourceRefs: z.array(z.string().min(1)).optional(),
        notesMarkdown: z.string().min(1).optional(),
        checkpointMarkdown: z.string().min(1).optional(),
        expectedRevision: expectedRevisionSchema
      }
    },
    async (args) => toolResult(async () => captureLearningSession(config, args))
  );

  server.registerTool(
    "validate_topic",
    {
      title: "Validate Revember topic",
      description: "Validate a topic file by slug, or validate a provided topic JSON object.",
      inputSchema: {
        slug: slugSchema.optional(),
        topic: z.unknown().optional()
      }
    },
    async (args) => toolResult(async () => {
      if (args.topic !== undefined) {
        return validateTopicData(args.topic);
      }
      if (!args.slug) {
        throw new Error("Provide either slug or topic.");
      }
      return validateTopicFile(config, args.slug);
    })
  );

  server.registerTool(
    "validate_knowledge_base",
    {
      title: "Validate Revember knowledge base",
      description: "Validate topics, learning sessions, declared note presence, and progress readability.",
      inputSchema: {}
    },
    async () => toolResult(async () => validateKnowledgeBase(config))
  );

  server.registerTool(
    "search_topics",
    {
      title: "Search Revember topics",
      description: "Search topic slug, title, tags, concept names, questions, and optional Markdown content.",
      inputSchema: {
        query: z.string().min(1),
        includeMarkdown: z.boolean().optional(),
        limit: z.number().int().positive().max(100).optional()
      }
    },
    async (args) => toolResult(async () => searchTopics(config, args.query, {
      includeMarkdown: args.includeMarkdown ?? true,
      limit: args.limit ?? 20
    }))
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search Revember knowledge and sessions",
      description: "Search topics, v2 sources/relationships/probe metadata, Markdown notes, and captured learning sessions.",
      inputSchema: {
        query: z.string().min(1),
        includeMarkdown: z.boolean().optional(),
        includeSessions: z.boolean().optional(),
        limit: z.number().int().positive().max(100).optional()
      }
    },
    async (args) => toolResult(async () => searchKnowledge(config, args.query, {
      includeMarkdown: args.includeMarkdown ?? true,
      includeSessions: args.includeSessions ?? true,
      limit: args.limit ?? 20
    }))
  );

  server.registerTool(
    "get_learner_brief",
    {
      title: "Get Revember learner brief",
      description: "Summarize due cards, evidence, weak concepts, misconceptions, and gap repair from legacy or v2 local progress.",
      inputSchema: {
        topicID: slugSchema.optional(),
        now: z.string().datetime({ offset: true }).optional(),
        includeRetired: z.boolean().optional()
      }
    },
    async (args) => toolResult(async () => getLearnerBrief(config, args))
  );

  server.registerTool(
    "get_review_plan",
    {
      title: "Get Revember review plan",
      description: "Return a short local review plan that prioritizes current due, revised, and untested cards from optional local progress.",
      inputSchema: {
        maxTopics: z.number().int().positive().max(10).optional(),
        includeProgress: z.boolean().optional()
      }
    },
    async (args) => toolResult(async () => buildReviewPlan(config, args.maxTopics ?? 3, args.includeProgress ?? true))
  );
}
