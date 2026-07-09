import fs from "node:fs/promises";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import type { RevemberConfig } from "./config.js";
import {
  createTopic,
  listTopicFiles,
  readTopic,
  updateTopic,
  validateTopicFile,
  writeMarkdown
} from "./topics.js";
import { validateTopicData } from "./schema.js";
import { searchTopics } from "./search.js";
import path from "node:path";

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use only letters, numbers, underscores, and hyphens.");

const difficultySchema = z.enum(["intro", "medium", "hard"]);

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

function topicProgressScore(progress: Record<string, unknown> | undefined): { attempts: number; score: number } {
  const attemptsByQuestionID = progress?.attemptsByQuestionID;
  if (!attemptsByQuestionID || typeof attemptsByQuestionID !== "object" || Array.isArray(attemptsByQuestionID)) {
    return { attempts: 0, score: 0 };
  }

  let attempts = 0;
  let correct = 0;

  for (const value of Object.values(attemptsByQuestionID as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const questionProgress = value as Record<string, unknown>;
    attempts += typeof questionProgress.attempts === "number" ? questionProgress.attempts : 0;
    correct += typeof questionProgress.correctAttempts === "number" ? questionProgress.correctAttempts : 0;
  }

  return {
    attempts,
    score: attempts > 0 ? correct / attempts : 0
  };
}

async function readProgress(config: RevemberConfig): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(config.progressPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function buildReviewPlan(config: RevemberConfig, maxTopics: number, includeProgress: boolean) {
  const progress = includeProgress ? await readProgress(config) : undefined;
  const progressTopics = progress?.topics && typeof progress.topics === "object" && !Array.isArray(progress.topics)
    ? (progress.topics as Record<string, Record<string, unknown>>)
    : {};

  const topics = [];
  for (const file of await listTopicFiles(config)) {
    const slug = path.basename(file, ".json");
    if (!slug) {
      continue;
    }

    try {
      const topic = await readTopic(config, slug);
      const progressScore = topicProgressScore(progressTopics[topic.id]);
      const weakConceptIDs = progressTopics[topic.id]?.weakConceptIDs;
      const weakConcepts = weakConceptIDs && typeof weakConceptIDs === "object" && !Array.isArray(weakConceptIDs)
        ? Object.keys(weakConceptIDs)
        : [];

      topics.push({
        id: topic.id,
        title: topic.title,
        summary: topic.summary,
        conceptCount: topic.concepts.length,
        questionCount: topic.questions.length,
        attempts: progressScore.attempts,
        score: progressScore.score,
        weakConcepts,
        focusConcepts: topic.concepts.slice(0, 4).map((concept) => concept.title)
      });
    } catch {
      continue;
    }
  }

  const selected = topics
    .sort((left, right) => {
      if (left.attempts !== right.attempts) {
        return left.attempts - right.attempts;
      }
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return right.questionCount - left.questionCount;
    })
    .slice(0, maxTopics);

  return {
    knowledgeRoot: config.knowledgeRoot,
    progressPath: includeProgress ? config.progressPath : undefined,
    plan: selected.map((topic) => ({
      topic: `${topic.title} (${topic.id})`,
      reason: topic.attempts === 0
        ? "No recorded retrieval attempts yet."
        : `Current recorded score is ${Math.round(topic.score * 100)}% across ${topic.attempts} attempts.`,
      steps: [
        `Review ${topic.focusConcepts.slice(0, 3).join(", ") || "the core concepts"}.`,
        `Answer ${Math.min(topic.questionCount, 5)} checkpoint question${Math.min(topic.questionCount, 5) === 1 ? "" : "s"}.`,
        topic.weakConcepts.length > 0
          ? `Revisit weak concept IDs: ${topic.weakConcepts.slice(0, 5).join(", ")}.`
          : "Write down one confusion to add back into the Markdown note."
      ]
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
        markdownBody: z.string().optional()
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
        patch: z.record(z.unknown())
      }
    },
    async (args) => toolResult(async () => updateTopic(config, args.slug, args.patch))
  );

  server.registerTool(
    "update_markdown_explanation",
    {
      title: "Update Revember Markdown explanation",
      description: "Replace or append the Markdown explanation for a topic in RevemberKnowledge/notes.",
      inputSchema: {
        slug: slugSchema,
        body: z.string().min(1),
        mode: z.enum(["replace", "append"]).optional()
      }
    },
    async (args) => toolResult(async () => ({
      markdown: await writeMarkdown(config, args.slug, args.body, args.mode ?? "replace")
    }))
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
    "get_review_plan",
    {
      title: "Get Revember review plan",
      description: "Return a short local review plan based on topic metadata and optional local progress.",
      inputSchema: {
        maxTopics: z.number().int().positive().max(10).optional(),
        includeProgress: z.boolean().optional()
      }
    },
    async (args) => toolResult(async () => buildReviewPlan(config, args.maxTopics ?? 3, args.includeProgress ?? true))
  );
}
