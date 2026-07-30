# RevemberKnowledge

This folder is the seed local knowledge store included with Revember v2. It is safe to use for a local demo. For personal learning, copy it to a writable private folder and choose that folder in the app's Settings.

For learning-session updates, use:

```text
LEARNING_WORKFLOW.md
```

It has three authored layers:

```text
notes/*.md
```

LLM-friendly source notes. Use Markdown for first-principles explanations, rough learning-session notes, examples, confusions, and open questions.

```text
topics/*.json
```

App-ready structured review data. The current contract is schema version 2. Use JSON for stable concept IDs, explicit concept relationships, source provenance, diagnostic checks, answer rationales, misconception IDs, and review-content revisions.

```text
sessions/*.json
```

Durable learning checkpoints. Session schema version 1 records what changed, the linked topic and topic revision when available, confirmed concepts, misconceptions, open questions, source references, and optional Markdown detail.

The app loads authored review material directly from:

```text
topics/*.json
```

Codex should update Markdown notes first when preserving general knowledge, then compile the relevant structured review material into JSON. Concept array order is presentation order only: knowledge-graph semantics must be authored in `relationships`, never inferred from adjacency. The app watches this folder and reloads valid topic saves automatically; it retains its last valid snapshot if a file is temporarily malformed. The topic loader reads JSON directly; that loading path uses no database, NLP backend, or AI service.

The current renderer supports a learner-capture editor and Notes reader alongside authored questions and review. It no longer exposes topic-note generation or manual concept/relationship management. Existing `captures/` and segmentation artifacts remain compatible with the local store, while question authoring can request editable local distractor suggestions; the learner must review and save the final question.

The registered local MCP server is the preferred mutation path because it provides atomic writes, backups, validation, and optimistic topic revisions. Read the topic first, pass its current `revision` as `expectedRevision`, and refresh after a conflict. The main focused tools are `upsert_concept`, `upsert_card`, `retire_card`, `update_markdown_explanation`, and `capture_learning_session`; `get_learner_brief` closes the loop by reading local progress back into the next lesson.

Generated backups (`.backups/`) and personal learning sessions (`sessions/`) are ignored by Git. Keep authored notes and topic JSON under version control; keep personal learning evidence local unless you explicitly want to share it.

The first seeded topic has both forms:

```text
notes/ble.md
topics/ble.json
```
