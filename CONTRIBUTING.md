# Contributing to Revember

Revember is a local-first macOS application. Keep product changes narrow, preserve the typed local-data contracts, and validate the user-visible flow you change.

## Setup and checks

Use the [run instructions](README.md#run-on-macos) for app-only work. Before opening a pull request, run:

~~~bash
npm run verify
npm run test:e2e
npm run test:package
git diff --check
~~~

Use Node.js 22 LTS (nvm use) or Node.js 24+. Do not use Node.js 23.

## Working agreements

- Keep learning data local. Do not add remote calls, telemetry, or cloud persistence without an explicit design review.
- Treat Ollama as optional and loopback-only. Generated text must stay editable and never save automatically.
- Keep Electron context isolation and renderer sandboxing enabled. Filesystem work belongs in the main process behind the typed preload API.
- Preserve topic, concept, question, source, relationship, and misconception IDs. Let the MCP server manage revisions when it authors knowledge.
- Keep the topic and progress JSON formats compatible with the MCP server and existing local data.
- Do not commit personal captures, generated .backups/, local sessions/, or build artifacts.
- Add focused tests for scheduling, validation, persistence, and changed interaction flows.

## Pull requests

State the user-visible result, data or security-boundary changes, and the validation commands you ran. Keep each pull request focused.
