import type { RevemberConfig } from "./config.js";
import { fileExists, markdownPath } from "./paths.js";
import { listTopicFiles, readMarkdown, readTopic } from "./topics.js";
import { searchSessions, type SessionSearchResult } from "./sessions.js";
import path from "node:path";

export interface SearchResult {
  type: "topic";
  id: string;
  title: string;
  matchedFields: string[];
  snippets: string[];
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function snippet(value: string, query: string): string {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  const index = normalizedValue.indexOf(normalizedQuery);

  if (index === -1) {
    return value.slice(0, 180);
  }

  const start = Math.max(0, index - 70);
  const end = Math.min(value.length, index + query.length + 110);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end)}${suffix}`.replace(/\s+/g, " ");
}

function addField(
  fields: Array<{ name: string; value: string }>,
  name: string,
  value: unknown
): void {
  if (typeof value === "string" && value.trim().length > 0) {
    fields.push({ name, value });
  }
}

function addStringArray(
  fields: Array<{ name: string; value: string }>,
  name: string,
  value: unknown
): void {
  if (!Array.isArray(value)) {
    return;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length > 0) {
    fields.push({ name, value: strings.join(" ") });
  }
}

export async function searchTopics(
  config: RevemberConfig,
  query: string,
  options: { includeMarkdown?: boolean; limit?: number } = {}
): Promise<SearchResult[]> {
  const normalizedQuery = normalize(query.trim());
  if (normalizedQuery.length === 0) {
    return [];
  }

  const includeMarkdown = options.includeMarkdown ?? true;
  const limit = options.limit ?? 20;
  const results: SearchResult[] = [];

  for (const file of await listTopicFiles(config)) {
    const id = path.basename(file, ".json");
    let topic;

    try {
      topic = await readTopic(config, id);
    } catch {
      continue;
    }

    const fields: Array<{ name: string; value: string }> = [];
    addField(fields, "slug", topic.id);
    addField(fields, "title", topic.title);
    addField(fields, "summary", topic.summary);
    addStringArray(fields, "tags", (topic as Record<string, unknown>).tags);
    for (const source of topic.sources ?? []) {
      addField(fields, "source.id", source.id);
      addField(fields, "source.kind", source.kind);
      addField(fields, "source.title", source.title);
      addField(fields, "source.locator", source.locator);
      addField(fields, "source.fingerprint", source.fingerprint);
      addField(fields, "source.capturedAt", source.capturedAt);
    }

    for (const relationship of topic.relationships ?? []) {
      addField(fields, "relationship.id", relationship.id);
      addField(fields, "relationship.kind", relationship.kind);
      addField(fields, "relationship.sourceConceptID", relationship.sourceConceptID);
      addField(fields, "relationship.targetConceptID", relationship.targetConceptID);
      addField(fields, "relationship.rationale", relationship.rationale);
      addStringArray(fields, "relationship.sourceRefs", relationship.sourceRefs);
    }

    for (const concept of topic.concepts) {
      addField(fields, "concept.id", concept.id);
      addField(fields, "concept.title", concept.title);
      addField(fields, "concept.firstPrinciples", concept.firstPrinciples);
      addField(fields, "concept.explanation", concept.explanation);
      addStringArray(fields, "concept.relatedTerms", concept.relatedTerms);
      addStringArray(fields, "concept.confusableTerms", concept.confusableTerms);
      addStringArray(fields, "concept.gapTags", concept.gapTags);
      addStringArray(fields, "concept.sourceRefs", concept.sourceRefs);
    }

    for (const gap of topic.gaps) {
      addField(fields, "gap.title", gap.title);
      addField(fields, "gap.tag", gap.tag);
      addField(fields, "gap.description", gap.description);
      addStringArray(fields, "gap.misconceptionIDs", gap.misconceptionIDs);
      addStringArray(fields, "gap.sourceRefs", gap.sourceRefs);
    }

    for (const question of topic.questions) {
      addField(fields, "question.prompt", question.prompt);
      addField(fields, "question.explanation", question.explanation);
      addField(fields, "question.kind", question.kind);
      addField(fields, "question.transferLevel", question.transferLevel);
      addField(fields, "question.retiredAt", question.retiredAt);
      addStringArray(fields, "question.sourceRefs", question.sourceRefs);
      for (const choice of question.choices) {
        addField(fields, "choice.text", choice.text);
        addField(fields, "choice.rationale", choice.rationale);
        addField(fields, "choice.misconceptionID", choice.misconceptionID);
      }
    }

    if (includeMarkdown && (await fileExists(markdownPath(config, id)))) {
      fields.push({ name: "markdown", value: await readMarkdown(config, id) });
    }

    const matchedFields = new Set<string>();
    const snippets: string[] = [];

    for (const field of fields) {
      if (normalize(field.value).includes(normalizedQuery)) {
        matchedFields.add(field.name);
        if (snippets.length < 4) {
          snippets.push(`${field.name}: ${snippet(field.value, query)}`);
        }
      }
    }

    if (matchedFields.size > 0) {
      results.push({
        type: "topic",
        id: topic.id,
        title: topic.title,
        matchedFields: [...matchedFields].sort(),
        snippets
      });
    }

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export async function searchKnowledge(
  config: RevemberConfig,
  query: string,
  options: { includeMarkdown?: boolean; includeSessions?: boolean; limit?: number } = {}
): Promise<Array<SearchResult | SessionSearchResult>> {
  const limit = options.limit ?? 20;
  const topics = await searchTopics(config, query, {
    ...(options.includeMarkdown !== undefined ? { includeMarkdown: options.includeMarkdown } : {}),
    limit
  });
  if (options.includeSessions === false || topics.length >= limit) return topics.slice(0, limit);
  const sessions = await searchSessions(config, query, limit - topics.length);
  return [...topics, ...sessions].slice(0, limit);
}
