# Contributing to Revember

## Local Setup

Use the [Quick Start](README.md#quick-start) commands, then run the checks before opening a pull request:

```bash
npm run check
npm run test:e2e
git diff --check
```

## Working Agreements

- Keep the app local-first: do not add network calls, telemetry, or cloud persistence without explicit design review.
- Keep Electron context isolation and renderer sandboxing enabled. Filesystem access belongs in the main process behind the narrow preload API.
- Preserve stable topic, concept, question, source, relationship, and misconception IDs. Increment revisions through the MCP tools when modifying authored knowledge.
- Keep the topic and progress JSON formats compatible with the MCP server and existing Revember data.
- Put reusable authored material in `RevemberKnowledge/notes/` and `RevemberKnowledge/topics/`; do not commit generated `.backups/` or personal `sessions/` data.
- Add focused domain tests for scheduling, validation, persistence, and queues, plus an Electron end-to-end check for user-visible workflow changes.

## Pull Requests

Describe the user-visible change, any Electron security-boundary or data-contract implications, and the validation commands you ran. Keep pull requests narrowly scoped when possible.
