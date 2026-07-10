# Contributing to Revember

## Local Setup

Use the [Quick Start](README.md#quick-start) commands, then run the checks before opening a pull request:

```bash
swift test
npm --prefix mcp-server run check
git diff --check
```

## Working Agreements

- Keep the app local-first: do not add network calls, telemetry, or cloud persistence without explicit design review.
- Preserve stable topic, concept, question, source, relationship, and misconception IDs. Increment revisions through the MCP tools when modifying authored knowledge.
- Put reusable authored material in `RevemberKnowledge/notes/` and `RevemberKnowledge/topics/`; do not commit generated `.backups/` or personal `sessions/` data.
- Keep documentation aligned with implemented behavior, especially scheduler, validation, and data-contract claims.
- Add or update focused tests when changing model, scheduling, persistence, or MCP behavior.

## Pull Requests

Describe the user-visible change, the data-contract implications, and the validation commands you ran. Keep pull requests narrowly scoped when possible.
