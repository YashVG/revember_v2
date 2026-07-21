import fs from "node:fs/promises";
import path from "node:path";
import type { RevemberConfig } from "./config.js";
import {
  assertRealPathInside,
  assertSafeSlug,
  atomicWriteFile,
  fileExists,
  markdownPath,
  safeReadFile,
  sessionPath
} from "./paths.js";
import { type LearningSession, LearningSessionSchema } from "./schema.js";
import {
  assertExpectedTopicRevision,
  bumpTopicRevision,
  readTopic,
  topicRevision,
  withTopicMutationLock,
  writeMarkdown,
  writeTopic
} from "./topics.js";
import { createKeyedMutationLock } from "./mutation.js";
import { errorMessage } from "./errors.js";

const withSessionLock = createKeyedMutationLock();

export interface CaptureLearningSessionInput {
  id: string;
  capturedAt?: string | undefined;
  title: string;
  summary: string;
  topicID?: string | undefined;
  confirmedConceptIDs?: string[] | undefined;
  misconceptionIDs?: string[] | undefined;
  openQuestions?: string[] | undefined;
  sourceRefs?: string[] | undefined;
  notesMarkdown?: string | undefined;
  checkpointMarkdown?: string | undefined;
  expectedRevision?: number | undefined;
}

export interface SessionSummary {
  id: string;
  title?: string | undefined;
  summary?: string | undefined;
  topicID?: string | undefined;
  capturedAt?: string | undefined;
  revision?: number | undefined;
  valid: boolean;
  error?: string | undefined;
}

function formatSession(session: LearningSession): string {
  return `${JSON.stringify(session, null, 2)}\n`;
}

function buildSession(input: CaptureLearningSessionInput, topicRevisionValue?: number): LearningSession {
  const candidate = {
    schemaVersion: 1,
    id: assertSafeSlug(input.id, "session id"),
    revision: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    title: input.title,
    summary: input.summary,
    ...(input.topicID ? { topicID: assertSafeSlug(input.topicID, "topic id") } : {}),
    ...(topicRevisionValue !== undefined ? { topicRevision: topicRevisionValue } : {}),
    confirmedConceptIDs: input.confirmedConceptIDs ?? [],
    misconceptionIDs: input.misconceptionIDs ?? [],
    openQuestions: input.openQuestions ?? [],
    sourceRefs: input.sourceRefs ?? [],
    ...(input.notesMarkdown ? { notesMarkdown: input.notesMarkdown } : {})
  };
  return LearningSessionSchema.parse(candidate);
}

async function writeNewSession(config: RevemberConfig, session: LearningSession): Promise<string> {
  const target = sessionPath(config, session.id);
  if (await fileExists(target)) {
    throw new Error(`Learning session already exists: ${session.id}.json.`);
  }
  await atomicWriteFile(config.knowledgeRoot, target, formatSession(session));
  return target;
}

async function restoreNote(config: RevemberConfig, target: string, original: string | undefined): Promise<void> {
  if (original === undefined) await fs.rm(target, { force: true });
  else await atomicWriteFile(config.knowledgeRoot, target, original);
}

async function withSessionMutationLock<T>(config: RevemberConfig, id: string, operation: () => Promise<T>): Promise<T> {
  return withSessionLock(sessionPath(config, id), operation);
}

async function captureLearningSessionUnlocked(
  config: RevemberConfig,
  input: CaptureLearningSessionInput
): Promise<{ session: LearningSession; sessionPath: string; topicRevision?: number | undefined; markdownPath?: string | undefined }> {
  const id = assertSafeSlug(input.id, "session id");
  const target = sessionPath(config, id);

  if (!input.topicID) {
    if (input.checkpointMarkdown !== undefined) {
      throw new Error("checkpointMarkdown requires topicID so Revember knows which note to update.");
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== 0) {
      throw new Error(`Revision conflict for new session "${id}": expected ${input.expectedRevision}, found 0.`);
    }
    const session = buildSession(input);
    return { session, sessionPath: await writeNewSession(config, session) };
  }

  const topicID = assertSafeSlug(input.topicID, "topic id");
  return withTopicMutationLock(config, topicID, async () => {
    const topic = await readTopic(config, topicID);
    assertExpectedTopicRevision(topic, input.expectedRevision);
    const missingConcepts = (input.confirmedConceptIDs ?? []).filter(
      (conceptID) => !topic.concepts.some((concept) => concept.id === conceptID)
    );
    if (missingConcepts.length > 0) {
      throw new Error(`Learning session references missing concept IDs: ${missingConcepts.join(", ")}.`);
    }
    if (await fileExists(target)) throw new Error(`Learning session already exists: ${id}.json.`);

    const nextTopicRevision = topicRevision(topic) + 1;
    const session = buildSession({ ...input, id, topicID }, nextTopicRevision);
    const noteTarget = markdownPath(config, topicID);
    const noteOriginal = (await fileExists(noteTarget))
      ? await safeReadFile(config.knowledgeRoot, noteTarget)
      : undefined;
    let sessionWritten = false;
    let noteWritten = false;
    let writtenMarkdownPath: string | undefined;

    try {
      await atomicWriteFile(config.knowledgeRoot, target, formatSession(session));
      sessionWritten = true;
      if (input.checkpointMarkdown !== undefined) {
        writtenMarkdownPath = (await writeMarkdown(config, topicID, input.checkpointMarkdown, "append")).path;
        noteWritten = true;
      }
      const bumpedTopic = bumpTopicRevision(topic);
      await writeTopic(config, topicID, input.checkpointMarkdown === undefined ? bumpedTopic : {
        ...bumpedTopic,
        markdownPath: (topic as Record<string, unknown>).markdownPath ?? `notes/${topicID}.md`
      });
      return {
        session,
        sessionPath: target,
        topicRevision: nextTopicRevision,
        markdownPath: writtenMarkdownPath
      };
    } catch (error) {
      if (sessionWritten) await fs.rm(target, { force: true }).catch(() => undefined);
      if (noteWritten) await restoreNote(config, noteTarget, noteOriginal).catch(() => undefined);
      throw error;
    }
  });
}

export async function captureLearningSession(
  config: RevemberConfig,
  input: CaptureLearningSessionInput
): Promise<{ session: LearningSession; sessionPath: string; topicRevision?: number | undefined; markdownPath?: string | undefined }> {
  const id = assertSafeSlug(input.id, "session id");
  return withSessionMutationLock(config, id, () => captureLearningSessionUnlocked(config, input));
}

export async function listSessionFiles(config: RevemberConfig): Promise<string[]> {
  await assertRealPathInside(config.knowledgeRoot, config.sessionsDir);
  try {
    const entries = await fs.readdir(config.sessionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => path.join(config.sessionsDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readLearningSession(config: RevemberConfig, id: string): Promise<LearningSession> {
  const safeID = assertSafeSlug(id, "session id");
  const target = sessionPath(config, safeID);
  const raw = await safeReadFile(config.knowledgeRoot, target);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON in session ${safeID}.json: ${errorMessage(error)}`);
  }
  const result = LearningSessionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid learning session ${safeID}.json: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  if (result.data.id !== safeID) {
    throw new Error(`Learning session id "${result.data.id}" must match file id "${safeID}".`);
  }
  return result.data;
}

export async function listSessionSummaries(config: RevemberConfig): Promise<SessionSummary[]> {
  const summaries: SessionSummary[] = [];
  for (const file of await listSessionFiles(config)) {
    const id = path.basename(file, ".json");
    try {
      const session = await readLearningSession(config, id);
      summaries.push({
        id,
        title: session.title,
        summary: session.summary,
        topicID: session.topicID,
        capturedAt: session.capturedAt,
        revision: session.revision,
        valid: true
      });
    } catch (error) {
      summaries.push({ id, valid: false, error: errorMessage(error) });
    }
  }
  return summaries;
}

export interface SessionSearchResult {
  type: "session";
  id: string;
  title: string;
  topicID?: string | undefined;
  matchedFields: string[];
  snippets: string[];
}

export async function searchSessions(config: RevemberConfig, query: string, limit = 20): Promise<SessionSearchResult[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SessionSearchResult[] = [];
  for (const file of await listSessionFiles(config)) {
    const id = path.basename(file, ".json");
    let session: LearningSession;
    try { session = await readLearningSession(config, id); } catch { continue; }
    const fields: Array<[string, string]> = [
      ["session.id", session.id],
      ["session.title", session.title],
      ["session.summary", session.summary],
      ["session.topicID", session.topicID ?? ""],
      ["session.confirmedConceptIDs", session.confirmedConceptIDs.join(" ")],
      ["session.misconceptionIDs", session.misconceptionIDs.join(" ")],
      ["session.openQuestions", session.openQuestions.join(" ")],
      ["session.sourceRefs", session.sourceRefs.join(" ")],
      ["session.notesMarkdown", session.notesMarkdown ?? ""]
    ];
    const matched = fields.filter(([, value]) => value.toLowerCase().includes(needle));
    if (matched.length > 0) {
      results.push({
        type: "session",
        id: session.id,
        title: session.title,
        topicID: session.topicID,
        matchedFields: [...new Set(matched.map(([name]) => name))].sort(),
        snippets: matched.slice(0, 4).map(([name, value]) => `${name}: ${value.replace(/\s+/g, " ").slice(0, 220)}`)
      });
    }
    if (results.length >= limit) break;
  }
  return results;
}
