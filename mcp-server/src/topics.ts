import fs from "node:fs/promises";
import path from "node:path";
import type { RevemberConfig } from "./config.js";
import {
  assertRealPathInside,
  assertSafeSlug,
  atomicWriteFile,
  backupIfExists,
  fileExists,
  markdownPath,
  safeReadFile,
  safeResolve,
  topicPath
} from "./paths.js";
import {
  type Difficulty,
  type KnowledgeTopic,
  TopicSchemaDocumentation,
  validateTopicData
} from "./schema.js";

const choiceIDs = "abcdefghijklmnopqrstuvwxyz".split("");

export interface TopicSummary {
  id: string;
  title?: string | undefined;
  summary?: string | undefined;
  tags: string[];
  conceptCount: number;
  gapCount: number;
  questionCount: number;
  topicPath: string;
  markdownPath?: string | undefined;
  valid: boolean;
  error?: string | undefined;
}

export interface ConceptCheckInput {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  difficulty?: Difficulty | undefined;
}

export interface CreateConceptInput {
  id?: string | undefined;
  title: string;
  body?: string | undefined;
  firstPrinciples?: string | undefined;
  explanation?: string | undefined;
  relatedTerms?: string[] | undefined;
  confusableTerms?: string[] | undefined;
  gapTags?: string[] | undefined;
  difficulty?: Difficulty | undefined;
  checks?: ConceptCheckInput[] | undefined;
}

export interface CreateTopicInput {
  slug: string;
  title: string;
  summary: string;
  tags?: string[] | undefined;
  concepts: CreateConceptInput[];
  markdownBody?: string | undefined;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "item";
}

function uniqueID(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  used.add(candidate);
  return candidate;
}

function tagsFromTopic(topic: Record<string, unknown>): string[] {
  const tags = new Set<string>();
  const topLevelTags = topic.tags;

  if (Array.isArray(topLevelTags)) {
    for (const tag of topLevelTags) {
      if (typeof tag === "string") {
        tags.add(tag);
      }
    }
  }

  const concepts = topic.concepts;
  if (Array.isArray(concepts)) {
    for (const concept of concepts) {
      if (!concept || typeof concept !== "object") {
        continue;
      }
      const gapTags = (concept as Record<string, unknown>).gapTags;
      if (!Array.isArray(gapTags)) {
        continue;
      }
      for (const tag of gapTags) {
        if (typeof tag === "string") {
          tags.add(tag);
        }
      }
    }
  }

  return [...tags].sort();
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listTopicFiles(config: RevemberConfig): Promise<string[]> {
  await assertRealPathInside(config.knowledgeRoot, config.topicsDir);
  return listJsonFiles(config.topicsDir);
}

export async function readTopicFileText(config: RevemberConfig, slug: string): Promise<string> {
  return safeReadFile(config.knowledgeRoot, topicPath(config, slug));
}

export async function readTopic(config: RevemberConfig, slug: string): Promise<KnowledgeTopic> {
  const text = await readTopicFileText(config, slug);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed JSON in ${slug}.json: ${asErrorMessage(error)}`);
  }

  const validation = validateTopicData(parsed, { expectedSlug: slug });
  if (!validation.valid || !validation.topic) {
    throw new Error(`Invalid topic ${slug}.json: ${validation.errors.join("; ")}`);
  }

  return validation.topic;
}

export async function listTopicSummaries(config: RevemberConfig): Promise<TopicSummary[]> {
  const files = await listTopicFiles(config);
  const summaries: TopicSummary[] = [];

  for (const file of files) {
    const id = path.basename(file, ".json");
    const markdownFile = markdownPath(config, id);

    try {
      await assertRealPathInside(config.knowledgeRoot, file);
      const raw = await safeReadFile(config.knowledgeRoot, file);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const validation = validateTopicData(parsed, { expectedSlug: id });
      const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
      const gaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
      const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

      summaries.push({
        id,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        tags: tagsFromTopic(parsed),
        conceptCount: concepts.length,
        gapCount: gaps.length,
        questionCount: questions.length,
        topicPath: file,
        markdownPath: (await fileExists(markdownFile)) ? markdownFile : undefined,
        valid: validation.valid,
        error: validation.valid ? undefined : validation.errors.join("; ")
      });
    } catch (error) {
      summaries.push({
        id,
        tags: [],
        conceptCount: 0,
        gapCount: 0,
        questionCount: 0,
        topicPath: file,
        markdownPath: (await fileExists(markdownFile)) ? markdownFile : undefined,
        valid: false,
        error: asErrorMessage(error)
      });
    }
  }

  return summaries;
}

export async function listMarkdownSlugs(config: RevemberConfig): Promise<string[]> {
  try {
    await assertRealPathInside(config.knowledgeRoot, config.notesDir);
    const entries = await fs.readdir(config.notesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
      .map((entry) => path.basename(entry.name, ".md"))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readMarkdown(config: RevemberConfig, slug: string): Promise<string> {
  return safeReadFile(config.knowledgeRoot, markdownPath(config, slug));
}

function formatTopic(topic: KnowledgeTopic): string {
  return `${JSON.stringify(topic, null, 2)}\n`;
}

async function writeTopic(
  config: RevemberConfig,
  slug: string,
  topic: KnowledgeTopic
): Promise<{ path: string; backup?: string | undefined }> {
  const validation = validateTopicData(topic, { expectedSlug: slug });
  if (!validation.valid || !validation.topic) {
    throw new Error(`Refusing to write invalid topic: ${validation.errors.join("; ")}`);
  }

  const target = topicPath(config, slug);
  const backup = await backupIfExists(config, "topics", target);
  await atomicWriteFile(config.knowledgeRoot, target, formatTopic(validation.topic));
  return { path: target, backup };
}

export async function createTopic(
  config: RevemberConfig,
  input: CreateTopicInput
): Promise<{ topic: KnowledgeTopic; topicPath: string; markdownPath?: string | undefined }> {
  const slug = assertSafeSlug(input.slug);
  const targetPath = topicPath(config, slug);
  const targetMarkdownPath = markdownPath(config, slug);

  if (await fileExists(targetPath)) {
    throw new Error(`Topic already exists: ${slug}.json. Use update_topic to modify it.`);
  }

  if (input.markdownBody !== undefined && await fileExists(targetMarkdownPath)) {
    throw new Error(`Markdown explanation already exists: ${slug}.md. Use update_markdown_explanation to modify it.`);
  }

  const usedConceptIDs = new Set<string>();
  const questions: KnowledgeTopic["questions"] = [];

  const concepts = input.concepts.map((concept, conceptIndex) => {
    const conceptID = uniqueID(slugify(concept.id ?? concept.title), usedConceptIDs);
    const explanation = concept.explanation ?? concept.body ?? concept.firstPrinciples ?? input.summary;
    const firstPrinciples = concept.firstPrinciples ?? concept.body ?? concept.explanation ?? input.summary;
    const gapTags = concept.gapTags ?? input.tags ?? [];

    for (const [checkIndex, check] of (concept.checks ?? []).entries()) {
      if (check.answerIndex < 0 || check.answerIndex >= check.choices.length) {
        throw new Error(`Check ${checkIndex + 1} for concept "${concept.title}" has an invalid answerIndex.`);
      }

      questions.push({
        id: uniqueID(`${conceptID}-check-${checkIndex + 1}`, new Set(questions.map((question) => question.id))),
        prompt: check.question,
        difficulty: check.difficulty ?? concept.difficulty ?? "intro",
        conceptIDs: [conceptID],
        gapTags,
        choices: check.choices.map((choice, choiceIndex) => ({
          id: choiceIDs[choiceIndex] ?? `choice-${choiceIndex + 1}`,
          text: choice,
          isCorrect: choiceIndex === check.answerIndex
        })),
        explanation: check.explanation
      });
    }

    return {
      id: conceptID,
      title: concept.title,
      firstPrinciples,
      explanation,
      relatedTerms: concept.relatedTerms ?? [],
      confusableTerms: concept.confusableTerms ?? [],
      gapTags
    };
  });

  const topic = {
    id: slug,
    title: input.title,
    summary: input.summary,
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.markdownBody !== undefined ? { markdownPath: `notes/${slug}.md` } : {}),
    concepts,
    gaps: [],
    questions
  };

  const validation = validateTopicData(topic, { expectedSlug: slug });
  if (!validation.valid || !validation.topic) {
    throw new Error(`Generated topic did not validate: ${validation.errors.join("; ")}`);
  }

  let writtenMarkdownPath: string | undefined;

  if (input.markdownBody !== undefined) {
    writtenMarkdownPath = (await writeMarkdown(config, slug, input.markdownBody, "replace")).path;
  }

  try {
    const writeResult = await writeTopic(config, slug, validation.topic);
    return { topic: validation.topic, topicPath: writeResult.path, markdownPath: writtenMarkdownPath };
  } catch (error) {
    if (writtenMarkdownPath !== undefined) {
      await fs.rm(writtenMarkdownPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(existing: unknown, patch: unknown): unknown {
  if (!isPlainObject(existing) || !isPlainObject(patch)) {
    return patch;
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

export async function updateTopic(
  config: RevemberConfig,
  slug: string,
  patch: Record<string, unknown>
): Promise<{ topic: KnowledgeTopic; topicPath: string; backup?: string | undefined; warnings: string[] }> {
  const existing = await readTopic(config, slug);
  const normalizedPatch = { ...patch };

  if (typeof normalizedPatch.slug === "string") {
    if (normalizedPatch.slug !== slug) {
      throw new Error(`Patch slug "${normalizedPatch.slug}" does not match target topic "${slug}".`);
    }
    delete normalizedPatch.slug;
  }

  if (typeof normalizedPatch.id === "string" && normalizedPatch.id !== existing.id) {
    throw new Error(`Refusing to change topic id from "${existing.id}" to "${normalizedPatch.id}".`);
  }

  const merged = deepMerge(existing, normalizedPatch);
  const validation = validateTopicData(merged, { expectedSlug: slug });
  if (!validation.valid || !validation.topic) {
    throw new Error(`Updated topic did not validate: ${validation.errors.join("; ")}`);
  }

  const writeResult = await writeTopic(config, slug, validation.topic);
  return {
    topic: validation.topic,
    topicPath: writeResult.path,
    backup: writeResult.backup,
    warnings: validation.warnings
  };
}

export async function writeMarkdown(
  config: RevemberConfig,
  slug: string,
  body: string,
  mode: "replace" | "append" = "replace"
): Promise<{ path: string; backup?: string | undefined }> {
  const target = markdownPath(config, slug);
  const backup = await backupIfExists(config, "notes", target);
  const existing = mode === "append" && (await fileExists(target)) ? await safeReadFile(config.knowledgeRoot, target) : "";
  const contents = mode === "append" && existing.length > 0 ? `${existing.trimEnd()}\n\n${body.trimEnd()}\n` : `${body.trimEnd()}\n`;

  await atomicWriteFile(config.knowledgeRoot, target, contents);
  return { path: target, backup };
}

export async function validateTopicFile(
  config: RevemberConfig,
  slug: string
): Promise<ReturnType<typeof validateTopicData>> {
  const text = await readTopicFileText(config, slug);
  try {
    return validateTopicData(JSON.parse(text), { expectedSlug: slug });
  } catch (error) {
    return {
      valid: false,
      errors: [`Malformed JSON in ${slug}.json: ${asErrorMessage(error)}`],
      warnings: []
    };
  }
}

export async function readSchemaDocumentation(): Promise<string> {
  return `${JSON.stringify(TopicSchemaDocumentation, null, 2)}\n`;
}

export async function readProjectDoc(config: RevemberConfig, name: string): Promise<string> {
  return safeReadFile(config.knowledgeRoot, projectDocPath(config, name));
}

export function projectDocPath(config: RevemberConfig, name: string): string {
  const docMap: Record<string, string> = {
    "knowledge-readme": safeResolve(config.knowledgeRoot, "README.md"),
    "learning-workflow": safeResolve(config.knowledgeRoot, "LEARNING_WORKFLOW.md"),
    "notes-readme": safeResolve(config.notesDir, "README.md")
  };

  const docPath = docMap[name];
  if (!docPath) {
    throw new Error(`Unknown Revember doc "${name}".`);
  }
  return docPath;
}

export async function listProjectDocs(config: RevemberConfig): Promise<Array<{ name: string; path: string }>> {
  const names = ["knowledge-readme", "learning-workflow", "notes-readme"];
  const docs: Array<{ name: string; path: string }> = [];

  for (const name of names) {
    const docPath = projectDocPath(config, name);
    if (await fileExists(docPath)) {
      docs.push({ name, path: docPath });
    }
  }

  return docs;
}
