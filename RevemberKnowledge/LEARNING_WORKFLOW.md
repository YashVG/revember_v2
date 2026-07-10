# Learning To Revember Workflow

Use this workflow when a Codex conversation uses the `learning` skill and the result should become testable in Revember.

## Teaching Mode

During the lesson, use the `learning` skill contract:

- ask one focused question at a time
- read the user's answer literally
- classify it as correct, partially correct, incorrect, or unclear
- correct the smallest useful gap
- keep an internal gap ledger
- keep tone direct and restrained

The lesson should teach from the user's current model, not from a prewritten fact dump.

## Knowledge Capture Rule

Anything meaningfully taught, corrected, confused, or clarified in the lesson should be captured in the knowledge base.

Use this split:

```text
notes/*.md    -> LLM-friendly source context
topics/*.json -> app-testable review material
```

Do not rely on the app to generate questions. Codex should write the review artifacts explicitly.

## End-Of-Lesson Update

Prefer the registered local Revember MCP tools for this sequence. Read the current topic revision first and pass it as `expectedRevision` to every mutation. If another writer has advanced the revision, refresh and reapply the intended semantic change rather than overwriting the topic.

At the end of each learning session, update or create a Markdown note:

```text
RevemberKnowledge/notes/<topic-id>.md
```

Include only useful learning residue:

- confirmed concepts
- corrected misconceptions
- gap tags
- examples from the user's project
- current mental model
- open questions
- candidate retrieval checks

Then update or create the app-ready JSON:

```text
RevemberKnowledge/topics/<topic-id>.json
```

Every new concept that should be testable in the app needs:

- a stable concept ID
- a first-principles statement
- an explanation
- related terms
- confusable terms
- gap tags
- source references for the authored explanation
- at least one diagnostic question when practical

Every gap should name its related concept IDs, source references, and stable misconception IDs when a distractor directly diagnoses that gap.

Every new diagnostic question needs:

- a stable question ID
- a revision number that increments when the prompt, intended answer, or diagnostic meaning changes
- a question kind and transfer level
- a prompt
- 2-4 answer choices
- one correct answer
- a rationale for every choice
- plausible wrong answers based on real confusions, each with a stable misconception ID
- concept IDs
- gap tags
- an explanation
- source references

Every topic also needs explicit provenance and structure:

- `schemaVersion` and topic `revision`
- `sources` with stable IDs and locators when available
- `relationships` with stable IDs, typed direction, rationale, and source references

Use `prerequisite`, `partOf`, `contrastsWith`, or `enables` for concept relationships. Do not use concept array order as a substitute for authored semantics.

Then capture the lesson residue with `capture_learning_session`. The stable session artifact lives at:

```text
RevemberKnowledge/sessions/<session-id>.json
```

Its required fields are `schemaVersion`, `id`, `revision`, `capturedAt`, `title`, `summary`, `confirmedConceptIDs`, `misconceptionIDs`, `openQuestions`, and `sourceRefs`. `topicID`, `topicRevision`, and `notesMarkdown` are optional. When `checkpointMarkdown` is supplied with a topic, the MCP server treats the session write, note append, and topic revision advance as one operation.

Use focused mutations rather than replacing an entire topic when possible:

- `upsert_concept` for one stable concept ID
- `upsert_card` for one diagnostic check; the server initializes or increments its card revision
- `retire_card` to stop scheduling obsolete content without deleting its history; retirement also increments the card revision
- `update_markdown_explanation` for source-note changes
- `validate_knowledge_base` before handing the result back

`create_topic` is a minimal bootstrap, not a finished lesson. Complete its source provenance and diagnostic quality with `upsert_concept` and `upsert_card` before relying on it for review.

Topic and card revisions are server-managed. Never place a caller-chosen `revision` in an `update_topic` patch or `upsert_card` payload, and never replace `questions` through `update_topic`.

At the start of the next lesson, call `get_learner_brief`. It combines due and untested cards, review accuracy, weak concepts, recorded misconceptions, gap status, and recent checkpoints. Treat this brief as learner evidence, not authored truth.

## Gap Tags

Prefer these reusable gap categories unless a topic needs something more specific:

- factual missing piece
- concept conflation
- terminology mismatch
- direction-of-causality error
- abstraction-level jump
- implementation mapping gap
- protocol/schema
- representation
- layer mapping

## Question Quality Bar

A good Revember question should test understanding, not trivia.

Useful forms:

- compare two concepts
- map a function or object to its system role
- predict what happens in a small scenario
- identify which layer owns a responsibility
- explain why a tempting answer is wrong

Classify each check as `multipleChoice`, `freeRecall`, `explain`, `predict`, `compare`, `trace`, or `debug`, and mark its transfer level as `recall`, `application`, or `transfer`. A check may still present choices while its diagnostic task is explain, predict, compare, trace, or debug.

Avoid:

- random distractors
- vocabulary that was not taught
- questions whose answer is only a memorized phrase
- more than one correct answer

## Validation

After editing JSON, run:

```bash
jq empty RevemberKnowledge/topics/<topic-id>.json
```

After MCP or cross-file changes, also run from `revember_v2/`:

```bash
npm --prefix mcp-server run check
```

If app code changed, also run from `revember_v2/`:

```bash
swift test
```

If only Markdown changed, Swift tests are not required.

## Pause Checkpoint

If the lesson pauses before the JSON is updated, capture a session checkpoint through MCP or add this compact checkpoint to the Markdown note:

```text
Learning Checkpoint

Topic:
  <topic>

Confirmed:
  - <concepts the user seems to understand>

Gaps:
  - <active gaps or misconceptions>

Current mental model:
  <short summary>

Candidate app checks:
  - <question prompt idea>
```

The goal is that no useful learning disappears just because the conversation stops.
