import type { RevemberConfig } from "./config.js";
import { fileExists, markdownPath } from "./paths.js";
import { listTopicFiles, readMarkdown, readTopic } from "./topics.js";
import path from "node:path";

export interface SearchResult {
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

    for (const concept of topic.concepts) {
      addField(fields, "concept.id", concept.id);
      addField(fields, "concept.title", concept.title);
      addField(fields, "concept.firstPrinciples", concept.firstPrinciples);
      addField(fields, "concept.explanation", concept.explanation);
      addStringArray(fields, "concept.relatedTerms", concept.relatedTerms);
      addStringArray(fields, "concept.confusableTerms", concept.confusableTerms);
      addStringArray(fields, "concept.gapTags", concept.gapTags);
    }

    for (const gap of topic.gaps) {
      addField(fields, "gap.title", gap.title);
      addField(fields, "gap.tag", gap.tag);
      addField(fields, "gap.description", gap.description);
    }

    for (const question of topic.questions) {
      addField(fields, "question.prompt", question.prompt);
      addField(fields, "question.explanation", question.explanation);
      for (const choice of question.choices) {
        addField(fields, "choice.text", choice.text);
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
