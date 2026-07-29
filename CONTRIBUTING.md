# Contributing to Revember

## Local Setup

Use the [Run on macOS](README.md#run-on-macos) commands for app-only development. Before opening a pull request, run the full gate:

```bash
npm run verify
npm run test:e2e
npm run test:package
git diff --check
```

Use Node.js 22 LTS (`nvm use`) or Node.js 24+. Do not use Node.js 23; it is outside the root package's supported engine range.

`npm run verify` clean-installs both lockfiles before checking the app and MCP server. After that bootstrap, `npm run verify:app` is the faster app-only rerun.

The supported build, package, and release surface is currently macOS. Do not claim Windows or Linux support without adding and validating those targets.

## Working Agreements

- Keep the app local-first: do not add remote network calls, telemetry, or cloud persistence without explicit design review. The optional Ollama integration is loopback-only and must remain usable as a best-effort enhancement.
- Keep draft-note persistence separate from local organization. Autosave must not call a model; Finish Lecture is the explicit organization boundary.
- Keep Electron context isolation and renderer sandboxing enabled. Filesystem access belongs in the main process behind the narrow preload API.
- Preserve stable topic, concept, question, source, relationship, and misconception IDs. Increment revisions through the MCP tools when modifying authored knowledge.
- Keep the topic and progress JSON formats compatible with the MCP server and existing Revember data.
- Put reusable authored material in `RevemberKnowledge/notes/` and `RevemberKnowledge/topics/`; do not commit generated `.backups/` or personal `sessions/` data.
- Add focused domain tests for scheduling, validation, persistence, and queues. Add an Electron end-to-end check for user-visible workflow changes and a package-smoke assertion for packaged boundaries.

## Pull Requests

Describe the user-visible change, any Electron security-boundary or data-contract implications, and the validation commands you ran. Keep pull requests narrowly scoped when possible.
