# Revember MCP Server

Local stdio MCP server for the Revember v2 knowledge base.

## Use with the packaged app

The macOS app bundles this server and its runtime. In Revember, open **Settings → AI study partner**, then choose **Connect Codex** or **Connect Claude**. The app registers the connection to the learning folder currently open in Revember, so no Node installation, repository checkout, or manual absolute-path configuration is needed. The connection follows later folder changes; restart the selected client after connecting or switching folders.

Use the repository instructions below only when developing or testing the server itself.

The server keeps the existing Revember app workflow intact:

- Topic JSON stays in `RevemberKnowledge/topics/*.json`.
- Markdown explanations stay in `RevemberKnowledge/notes/*.md`.
- Learning checkpoints stay in `RevemberKnowledge/sessions/*.json`.
- App progress stays local in `~/Library/Application Support/RevemberV2/progress.json`.
- There is no backend, login system, database, or remote service.

## Install

```bash
cd mcp-server
npm ci
npm run check
```

## Configuration

The server defaults to the checked-in knowledge store:

```text
<repo>/RevemberKnowledge
```

You can override paths with environment variables:

```bash
export REVEMBER_KNOWLEDGE_ROOT="/absolute/path/to/RevemberKnowledge"
export REVEMBER_PROGRESS_PATH="$HOME/Library/Application Support/RevemberV2/progress.json"
```

See `.env.example` for a copyable example. The server reads environment variables directly; it does not automatically load `.env`.

## Run Locally

For an MCP client that launches stdio servers:

```bash
cd mcp-server
npm run build
node dist/index.js
```

For development:

```bash
cd mcp-server
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
        "<absolute-path-to-revember_v2>/mcp-server/dist/index.js"
      ],
      "env": {
        "REVEMBER_KNOWLEDGE_ROOT": "<absolute-path-to-revember_v2>/RevemberKnowledge",
        "REVEMBER_PROGRESS_PATH": "<absolute-path-to-progress.json>"
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
  "args": ["<absolute-path-to-revember_v2>/mcp-server/dist/index.js"],
  "env": {
    "REVEMBER_KNOWLEDGE_ROOT": "<absolute-path-to-revember_v2>/RevemberKnowledge"
  }
}
```

The server communicates over stdio, so it should not print normal logs to stdout.

`npm run test:transport` launches the built server exactly as an MCP client does, verifies its advertised tools/resources, validates the live knowledge root, and reads the learner brief without mutating authored knowledge.

The server does not start an HTTP listener or expose static-file routes. See the repository [security policy](../SECURITY.md#dependency-audit-status) for the current SDK dependency-audit status and stdio-only mitigation.

## Resources

- `revember://topics` lists topic metadata, schema versions, revisions, and active/retired card counts.
- `revember://topic/{slug}` reads a specific topic JSON file.
- `revember://markdown/{slug}` reads `notes/{slug}.md`.
- `revember://sessions` lists captured learning checkpoints.
- `revember://session/{id}` reads one checkpoint from `sessions/{id}.json`.
- `revember://learner/brief` derives the current evidence-backed learner state.
- `revember://validation` validates the whole knowledge base and local progress readability.
- `revember://schema/topic` returns the documented app topic schema.
- `revember://docs/{name}` reads available knowledge docs:
  - `knowledge-readme`
  - `learning-workflow`
  - `notes-readme`

## Tools

- `create_topic`: create a schema-v2 topic at revision 1, with optional Markdown, sources, and explicit relationships.
- `update_topic`: deep-patch a topic and atomically increment its revision.
- `upsert_concept`: create or patch one concept without replacing the rest of the topic.
- `upsert_card`: create or patch one question/card/probe, incrementing its server-managed revision and preserving the rest of the topic.
- `retire_card`: timestamp a card as retired, increment its revision, and preserve its history.
- `update_markdown_explanation`: replace or append `notes/{slug}.md` and advance the linked topic revision.
- `capture_learning_session`: transactionally write `sessions/{id}.json`, optionally append a topic-note checkpoint, and advance the topic revision.
- `validate_topic`: validate a topic file or a provided JSON object.
- `validate_knowledge_base`: validate every topic/session, declared note presence, topic/session consistency, and progress JSON readability.
- `search_topics`: search legacy fields plus sources, relationships, probe metadata, rationales, and misconception IDs.
- `search_knowledge`: search topics, Markdown, and captured learning sessions together.
- `get_learner_brief`: derive due cards, untested cards, accuracy, weak concepts, misconceptions, gap status, and current scheduler versions from either legacy progress or v2 review events/schedules.
- `get_review_plan`: return a short local review plan that prioritizes current due cards, then revised or untested cards, using the same v2 learner evidence as the app.

`mark_topic_reviewed` is intentionally not exposed. The app records review events and schedule updates together from a submitted answer; writing standalone review events could make the local progress state misleading.

`create_topic` creates a valid starting point, but it does not supply the full teaching-quality detail expected for a finished lesson. Use `upsert_concept` and `upsert_card` to add source provenance, diagnostic choices, rationales, and misconception IDs.

## Revisions and Concurrency

Every mutation tool accepts `expectedRevision`. Existing legacy topics without a revision are treated as revision `0`; the first MCP mutation upgrades them to schema v2 and revision `1`. A mismatch fails with a revision conflict before anything is written. Supplying `expectedRevision` is strongly recommended for every client write.

Topic and card revision fields are server-managed. Do not include `revision` in an `update_topic.patch` or `upsert_card.card`, and do not replace the `questions` array through `update_topic`; use `upsert_card` or `retire_card`. New cards start at revision 1, and every card upsert or retirement increments both the card revision and topic revision.

```json
{
  "slug": "c-pointers",
  "expectedRevision": 7,
  "concept": {
    "id": "pointer-indirection",
    "explanation": "Indirection follows an address to the referred object."
  }
}
```

Simultaneous writers are serialized inside the server, so two writes using the same expected revision cannot both succeed.

## Learning Session Artifact

`capture_learning_session` writes this stable, local format:

```json
{
  "schemaVersion": 1,
  "id": "pointers-2026-07-09",
  "revision": 1,
  "capturedAt": "2026-07-09T08:00:00.000Z",
  "title": "Pointer checkpoint",
  "summary": "Separated addresses from addressed values.",
  "topicID": "c-pointers",
  "topicRevision": 8,
  "confirmedConceptIDs": ["pointer-indirection"],
  "misconceptionIDs": ["address-is-value"],
  "openQuestions": ["How does pointer arithmetic scale?"],
  "sourceRefs": ["c-standard"],
  "notesMarkdown": "Optional session-specific detail."
}
```

`topicID`, `topicRevision`, and `notesMarkdown` are optional. Passing `checkpointMarkdown` appends that text to `notes/{topicID}.md`; the session, note append, and topic-revision advance succeed or roll back together.

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

## Topic Schema

The legacy Revember topic shape remains valid. New MCP-created or mutated topics add `schemaVersion` and `revision`, while all richer fields are additive:

```json
{
  "schemaVersion": 2,
  "revision": 8,
  "id": "string",
  "title": "string",
  "summary": "string",
  "sources": [
    {
      "id": "source-id",
      "kind": "note|specification|book|article|other",
      "title": "source title",
      "locator": "optional path or URI",
      "fingerprint": "optional content fingerprint",
      "capturedAt": "optional ISO-8601 timestamp"
    }
  ],
  "relationships": [
    {
      "id": "relationship-id",
      "sourceConceptID": "concept-id",
      "targetConceptID": "concept-id",
      "kind": "prerequisite|partOf|contrastsWith|enables",
      "rationale": "why the relationship is authored",
      "sourceRefs": ["source-id"]
    }
  ],
  "concepts": [
    {
      "id": "string",
      "title": "string",
      "firstPrinciples": "string",
      "explanation": "string",
      "relatedTerms": ["string"],
      "confusableTerms": ["string"],
      "gapTags": ["string"],
      "sourceRefs": ["source-id"]
    }
  ],
  "gaps": [],
  "questions": [
    {
      "id": "string",
      "revision": 1,
      "prompt": "string",
      "difficulty": "intro|medium|hard",
      "kind": "multipleChoice|freeRecall|explain|predict|compare|trace|debug",
      "transferLevel": "recall|application|transfer",
      "sourceRefs": ["source-id"],
      "retiredAt": "optional ISO-8601 timestamp",
      "conceptIDs": ["string"],
      "gapTags": ["string"],
      "choices": [
        {
          "id": "string",
          "text": "string",
          "isCorrect": true,
          "rationale": "optional choice-specific reasoning",
          "misconceptionID": "optional diagnostic misconception"
        }
      ],
      "explanation": "string"
    }
  ]
}
```

Questions remain in the `questions` array so the app and MCP server share one canonical JSON contract; the MCP API uses “card” and “probe” as workflow names. Legacy MCP aliases such as `multiple-choice`, `fromConceptID`, and source `uri` are accepted at validation boundaries but normalized before writing. Answer choices remain required for every current probe kind. Unknown fields are preserved by update operations and ignored by app versions that do not know them.

## Progress Compatibility

`get_learner_brief` reads both the legacy aggregate model and the v2 scheduler model. The first-class v2 names are:

- `ProgressRecord.reviewEvents`
- `TopicProgress.reviewCardsByQuestionID`
- review events with `topicID`, `questionID`, `choiceID`, `isCorrect`, `rating`, `conceptIDs`, `gapTags`, and `reviewedAt`
- revision-aware review events may also carry `questionRevision`, prompt/answer snapshots, `misconceptionIDs`, and `sourceRefs`
- card state with `schedulerVersion`, `questionRevision`, `dueAt`, `intervalDays`, `stability`, `difficulty`, `lastRating`, `lapses`, `reviews`, and `lastReviewedAt`

Legacy `attemptsByQuestionID`, `weakConceptIDs`, and common event/schedule aliases continue to work. Missing evidence revisions mean revision 1. `get_learner_brief` exposes each card's `schedulerVersion` plus the distinct current versions in `progress.schedulerVersions`, so an eventual FSRS adapter remains distinguishable from the transparent `simple-v1` schedule. When an authored card advances, old events, schedules, and aggregates are reported through `staleAttempts`/`staleEvidence` but cannot make the current revision tested, due, weak, or resolved. When both current aggregate and event evidence exists for a card, review events are authoritative and aggregates are retained only as compatibility context.

## Safety

- Topic and Markdown slugs are restricted to letters, numbers, underscores, and hyphens.
- Session IDs and topic/concept/card IDs accepted by mutation tools use the same safe-slug restriction.
- Tools refuse path traversal and never write outside the configured knowledge directory.
- JSON is validated before writing.
- Existing topic and Markdown files are backed up under `RevemberKnowledge/.backups/`.
- Writes use temp files and atomic rename.
- Multi-file learning-session capture rolls back its new session and note change if any later commit step fails.
- Optimistic revision checks and per-entity mutation locks prevent lost updates inside one server process.
