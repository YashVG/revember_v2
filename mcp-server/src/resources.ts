import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RevemberConfig } from "./config.js";
import { assertSafeSlug } from "./paths.js";
import {
  listMarkdownSlugs,
  listProjectDocs,
  listTopicSummaries,
  projectDocPath,
  readMarkdown,
  readProjectDoc,
  readSchemaDocumentation,
  readTopicFileText
} from "./topics.js";

function textResource(uri: URL, text: string, mimeType: string) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType,
        text
      }
    ]
  };
}

function variableToString(value: string | string[] | undefined, name: string): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) {
    throw new Error(`Missing URI variable: ${name}`);
  }
  return resolved;
}

export function registerResources(server: McpServer, config: RevemberConfig): void {
  server.registerResource(
    "revember-topic-index",
    "revember://topics",
    {
      title: "Revember topic index",
      description: "List all topic JSON files available in the configured RevemberKnowledge folder.",
      mimeType: "application/json"
    },
    async (uri) => textResource(uri, `${JSON.stringify(await listTopicSummaries(config), null, 2)}\n`, "application/json")
  );

  server.registerResource(
    "revember-topic-schema",
    "revember://schema/topic",
    {
      title: "Revember topic schema",
      description: "Documented topic JSON shape expected by the SwiftUI app.",
      mimeType: "application/json"
    },
    async (uri) => textResource(uri, await readSchemaDocumentation(), "application/json")
  );

  server.registerResource(
    "revember-topic-json",
    new ResourceTemplate("revember://topic/{slug}", {
      list: async () => ({
        resources: (await listTopicSummaries(config)).map((topic) => ({
          uri: `revember://topic/${topic.id}`,
          name: topic.title ?? topic.id,
          description: topic.summary ?? topic.error ?? "Revember topic JSON",
          mimeType: "application/json"
        }))
      }),
      complete: {
        slug: async (value) => {
          const topics = await listTopicSummaries(config);
          return topics.map((topic) => topic.id).filter((id) => id.startsWith(value));
        }
      }
    }),
    {
      title: "Revember topic JSON",
      description: "Read a specific topic JSON file by slug.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const slug = assertSafeSlug(variableToString(variables.slug, "slug"));
      return textResource(uri, await readTopicFileText(config, slug), "application/json");
    }
  );

  server.registerResource(
    "revember-markdown-explanation",
    new ResourceTemplate("revember://markdown/{slug}", {
      list: async () => ({
        resources: (await listMarkdownSlugs(config)).map((slug) => ({
          uri: `revember://markdown/${slug}`,
          name: `${slug}.md`,
          description: "Revember Markdown source explanation",
          mimeType: "text/markdown"
        }))
      }),
      complete: {
        slug: async (value) => {
          const slugs = await listMarkdownSlugs(config);
          return slugs.filter((slug) => slug.startsWith(value));
        }
      }
    }),
    {
      title: "Revember Markdown explanation",
      description: "Read a Markdown explanation from RevemberKnowledge/notes.",
      mimeType: "text/markdown"
    },
    async (uri, variables) => {
      const slug = assertSafeSlug(variableToString(variables.slug, "slug"));
      return textResource(uri, await readMarkdown(config, slug), "text/markdown");
    }
  );

  server.registerResource(
    "revember-doc",
    new ResourceTemplate("revember://docs/{name}", {
      list: async () => ({
        resources: (await listProjectDocs(config)).map((doc) => ({
          uri: `revember://docs/${doc.name}`,
          name: doc.name,
          description: "Revember knowledge-base documentation",
          mimeType: "text/markdown"
        }))
      }),
      complete: {
        name: async (value) => {
          const docs = await listProjectDocs(config);
          return docs.map((doc) => doc.name).filter((name) => name.startsWith(value));
        }
      }
    }),
    {
      title: "Revember docs",
      description: "Read RevemberKnowledge README and workflow documentation.",
      mimeType: "text/markdown"
    },
    async (uri, variables) => {
      const name = variableToString(variables.name, "name");
      projectDocPath(config, name);
      return textResource(uri, await readProjectDoc(config, name), "text/markdown");
    }
  );
}
