import path from "node:path";
import type { RevemberConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { readProgressSnapshot } from "./learner.js";
import { listSessionFiles, readLearningSession } from "./sessions.js";
import {
  listMarkdownSlugs,
  listTopicFiles,
  readTopic,
  validateTopicFile
} from "./topics.js";

export interface KnowledgeBaseValidation {
  valid: boolean;
  checkedAt: string;
  counts: { topics: number; sessions: number; markdownNotes: number; errors: number; warnings: number };
  topics: Array<{ id: string; valid: boolean; errors: string[]; warnings: string[] }>;
  sessions: Array<{ id: string; valid: boolean; errors: string[]; warnings: string[] }>;
  errors: string[];
  warnings: string[];
  progress: { exists: boolean; readable: boolean; error?: string | undefined };
}

export async function validateKnowledgeBase(config: RevemberConfig): Promise<KnowledgeBaseValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const topicResults: KnowledgeBaseValidation["topics"] = [];
  const sessionResults: KnowledgeBaseValidation["sessions"] = [];
  const topicIDs = new Set<string>();

  for (const file of await listTopicFiles(config)) {
    const id = path.basename(file, ".json");
    topicIDs.add(id);
    const validation = await validateTopicFile(config, id);
    topicResults.push({ id, valid: validation.valid, errors: validation.errors, warnings: validation.warnings });
    errors.push(...validation.errors.map((error) => `topics/${id}.json: ${error}`));
    warnings.push(...validation.warnings.map((warning) => `topics/${id}.json: ${warning}`));
  }

  for (const file of await listSessionFiles(config)) {
    const id = path.basename(file, ".json");
    const sessionErrors: string[] = [];
    const sessionWarnings: string[] = [];
    try {
      const session = await readLearningSession(config, id);
      if (session.topicID && !topicIDs.has(session.topicID)) {
        sessionErrors.push(`references missing topic "${session.topicID}".`);
      } else if (session.topicID) {
        const topic = await readTopic(config, session.topicID);
        for (const conceptID of session.confirmedConceptIDs) {
          if (!topic.concepts.some((concept) => concept.id === conceptID)) {
            sessionWarnings.push(`confirmedConceptIDs references missing concept "${conceptID}".`);
          }
        }
        if (session.topicRevision !== undefined && session.topicRevision > (topic.revision ?? 0)) {
          sessionWarnings.push(`topicRevision ${session.topicRevision} is newer than current topic revision ${topic.revision ?? 0}.`);
        }
      }
    } catch (error) {
      sessionErrors.push(errorMessage(error));
    }
    sessionResults.push({ id, valid: sessionErrors.length === 0, errors: sessionErrors, warnings: sessionWarnings });
    errors.push(...sessionErrors.map((error) => `sessions/${id}.json: ${error}`));
    warnings.push(...sessionWarnings.map((warning) => `sessions/${id}.json: ${warning}`));
  }

  const markdownSlugs = await listMarkdownSlugs(config);
  for (const slug of markdownSlugs) {
    if (slug !== "README" && !topicIDs.has(slug)) {
      warnings.push(`notes/${slug}.md has no matching topic JSON.`);
    }
  }
  for (const topicID of topicIDs) {
    const topic = topicResults.find((candidate) => candidate.id === topicID);
    if (!topic?.valid) continue;
    const parsed = await readTopic(config, topicID);
    const markdownPath = (parsed as Record<string, unknown>).markdownPath;
    if (typeof markdownPath === "string" && !markdownSlugs.includes(topicID)) {
      warnings.push(`topics/${topicID}.json declares markdownPath but notes/${topicID}.md is missing.`);
    }
  }

  const progressSnapshot = await readProgressSnapshot(config);
  if (progressSnapshot.error) errors.push(`progress: ${progressSnapshot.error}`);

  return {
    valid: errors.length === 0,
    checkedAt: new Date().toISOString(),
    counts: {
      topics: topicResults.length,
      sessions: sessionResults.length,
      markdownNotes: markdownSlugs.length,
      errors: errors.length,
      warnings: warnings.length
    },
    topics: topicResults,
    sessions: sessionResults,
    errors,
    warnings,
    progress: {
      exists: progressSnapshot.exists,
      readable: progressSnapshot.error === undefined,
      error: progressSnapshot.error
    }
  };
}
