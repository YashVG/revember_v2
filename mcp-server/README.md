# Revember MCP Server

Local stdio MCP server for the Revember v2 knowledge base.

The server keeps the existing Revember app workflow intact:

- Topic JSON stays in `RevemberKnowledge/topics/*.json`.
- Markdown explanations stay in `RevemberKnowledge/notes/*.md`.
- App progress stays local in `~/Library/Application Support/RevemberV2/progress.json`.
- There is no backend, login system, database, or remote service.

## Install

```bash
cd /Users/yash/Desktop/revember_v2_codex_project/revember_v2/mcp-server
npm install
npm run build
npm test
```

## Configuration

The server defaults to the project knowledge folder next to this package:

```text
/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge
```

You can override paths with environment variables:

```bash
export REVEMBER_KNOWLEDGE_ROOT="/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge"
export REVEMBER_PROGRESS_PATH="$HOME/Library/Application Support/RevemberV2/progress.json"
```

See `.env.example` for a copyable example. The server reads environment variables directly; it does not automatically load `.env`.

## Run Locally

For an MCP client that launches stdio servers:

```bash
REVEMBER_KNOWLEDGE_ROOT="/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge" \
node /Users/yash/Desktop/revember_v2_codex_project/revember_v2/mcp-server/dist/index.js
```

For development:

```bash
cd /Users/yash/Desktop/revember_v2_codex_project/revember_v2/mcp-server
npm run dev
```

## Claude Desktop

After `npm run build`, add a server entry like this to Claude Desktop's MCP config:

```json
{
  "mcpServers": {
    "revember": {
      "command": "node",
      "args": [
        "/Users/yash/Desktop/revember_v2_codex_project/revember_v2/mcp-server/dist/index.js"
      ],
      "env": {
        "REVEMBER_KNOWLEDGE_ROOT": "/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge",
        "REVEMBER_PROGRESS_PATH": "/Users/yash/Library/Application Support/RevemberV2/progress.json"
      }
    }
  }
}
```

On macOS, Claude Desktop commonly reads this from:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Restart Claude Desktop after editing the config.

## Codex-Style Local Usage

Use the same stdio command from any MCP-compatible local client:

```json
{
  "command": "node",
  "args": ["/Users/yash/Desktop/revember_v2_codex_project/revember_v2/mcp-server/dist/index.js"],
  "env": {
    "REVEMBER_KNOWLEDGE_ROOT": "/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge"
  }
}
```

The server communicates over stdio, so it should not print normal logs to stdout.

## Resources

- `revember://topics` lists all topic JSON files and basic metadata.
- `revember://topic/{slug}` reads a specific topic JSON file.
- `revember://markdown/{slug}` reads `notes/{slug}.md`.
- `revember://schema/topic` returns the documented app topic schema.
- `revember://docs/{name}` reads available knowledge docs:
  - `knowledge-readme`
  - `learning-workflow`
  - `notes-readme`

## Tools

- `create_topic`: create a new topic JSON from `slug`, `title`, `summary`, `concepts`, optional `tags`, and optional `markdownBody`.
- `update_topic`: patch an existing topic JSON while preserving fields not included in the patch.
- `update_markdown_explanation`: replace or append `notes/{slug}.md`.
- `validate_topic`: validate a topic file or a provided JSON object.
- `search_topics`: search slug, title, tags, concept names, questions, and Markdown content.
- `get_review_plan`: return a short local review plan using topic metadata and, when present, local progress.

`mark_topic_reviewed` is intentionally not exposed. The app's current progress model records review through checkpoint answers, and writing standalone review events could make the app's progress state misleading.

## Example Tool Arguments

```json
{
  "slug": "c-pointers",
  "title": "C Pointers",
  "summary": "Addresses, indirection, and common pointer mistakes.",
  "tags": ["c", "firmware"],
  "concepts": [
    {
      "title": "Pointer Value",
      "body": "A pointer value is an address that refers to another object.",
      "gapTags": ["memory model"],
      "checks": [
        {
          "question": "What does a pointer store?",
          "choices": ["An address", "A Bluetooth packet", "A compiler warning"],
          "answerIndex": 0,
          "explanation": "The pointer's value is an address."
        }
      ]
    }
  ],
  "markdownBody": "# C Pointers\n\nA pointer is a value used for indirection."
}
```

## Schema Assumptions

The server validates against the schema already used by the Swift app:

```json
{
  "id": "string",
  "title": "string",
  "summary": "string",
  "concepts": [
    {
      "id": "string",
      "title": "string",
      "firstPrinciples": "string",
      "explanation": "string",
      "relatedTerms": ["string"],
      "confusableTerms": ["string"],
      "gapTags": ["string"]
    }
  ],
  "gaps": [],
  "questions": [
    {
      "id": "string",
      "prompt": "string",
      "difficulty": "intro|medium|hard",
      "conceptIDs": ["string"],
      "gapTags": ["string"],
      "choices": [
        {
          "id": "string",
          "text": "string",
          "isCorrect": true
        }
      ],
      "explanation": "string"
    }
  ]
}
```

MCP tool inputs accept `slug` as an alias for the app's `id`. Unknown fields are preserved by update operations and ignored by the Swift app.

## Safety

- Topic and Markdown slugs are restricted to letters, numbers, underscores, and hyphens.
- Tools refuse path traversal and never write outside the configured knowledge directory.
- JSON is validated before writing.
- Existing topic and Markdown files are backed up under `RevemberKnowledge/.backups/`.
- Writes use temp files and atomic rename.
