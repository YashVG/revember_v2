<p align="center">
  <img src="docs/brand/revember-logo.svg" alt="Revember" width="512">
</p>

<p align="center">
  <strong>A local-first Electron app for turning technical learning into evidence-backed review.</strong>
</p>

# Revember

Revember helps you keep technical understanding durable. Learn from first principles, capture the concepts and misconceptions that matter, then review exactly what needs fresh evidence. Your knowledge, review history, and scheduling state remain readable local files—there is no account, backend, telemetry, or cloud sync.

The desktop app is built with Electron, React, and TypeScript. It preserves the original Revember topic and progress formats, including the existing `~/Library/Application Support/RevemberV2/progress.json` location on macOS, so current learning history and the optional MCP workflow continue to work.

## Quick Start

**Requirements:** Node.js 22 or newer and npm. Packaging and installation commands below target macOS; the Electron application code is platform-aware.

```bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm ci
./script/set_project_knowledge_path.sh
npm run dev
```

The app opens with the included Bluetooth Low Energy module. Use Concept Map to inspect the learning ladder, Graph to explore authored relationships, Check-In for a single topic, or Start Review for the due queue.

## Desktop Features

- A dark retrieval cockpit with concept, graph, and check-in modes.
- Revision-aware spaced repetition with an append-only local review-event ledger.
- Local topic JSON, Markdown explanations, progress, backups, and learning checkpoints.
- Live reload when topic files change while preserving the last valid snapshot during partial edits.
- Folder selection, tray status, menu shortcuts, deep links, and opt-in desktop reminders.
- A checkpoint dialog that writes MCP-readable `sessions/*.json` artifacts.
- An optional local stdio MCP server for safe knowledge authoring and learner-state retrieval.

## Local Data

The checked-in `RevemberKnowledge/` folder is a safe seed module. For private material, copy it somewhere writable and choose that folder in Settings:

```bash
cp -R RevemberKnowledge "$HOME/Documents/RevemberKnowledge"
```

On macOS, review progress remains at:

```text
~/Library/Application Support/RevemberV2/progress.json
```

You can override both paths when developing or testing:

```bash
export REVEMBER_KNOWLEDGE_ROOT="/absolute/path/to/RevemberKnowledge"
export REVEMBER_PROGRESS_PATH="$HOME/Library/Application Support/RevemberV2/progress.json"
```

## Build and Install

Build the Electron main, preload, and renderer bundles:

```bash
npm run build
```

Create an unpacked macOS application under `release/`:

```bash
npm run package
```

Install the packaged app into `/Applications` after you like the current local version:

```bash
./script/build_and_run.sh --install
```

Create DMG and ZIP release artifacts with `npm run dist`. Distribution outside local development still requires the normal Apple signing and notarization credentials.

## Optional MCP Server

The app works without Node-based AI tooling after it has been packaged. Install the local stdio MCP server only when you want Codex, Claude Desktop, or another compatible client to create or revise knowledge:

```bash
npm --prefix mcp-server ci
npm --prefix mcp-server run check
```

The server reads the same topic, session, and progress files as the Electron app. See [the MCP guide](mcp-server/README.md) for configuration and tools.

## Repository Map

| Path | Purpose |
| --- | --- |
| `electron/` | Main process, isolated preload bridge, persistence, filesystem watching, and native desktop integrations |
| `src/renderer/` | React cockpit, graph, review flows, settings, and checkpoint UI |
| `shared/` | Topic/progress contracts, validation, scheduler, queue, and graph derivation shared across processes |
| `tests-electron/` | Domain tests and real Electron end-to-end verification |
| `RevemberKnowledge/` | Seed Markdown and schema-v2 learning content |
| `mcp-server/` | Optional TypeScript stdio MCP server |
| `docs/architecture/` | Data contracts and closed-loop architecture |

## Verification

Run the complete app and MCP checks:

```bash
npm run check
npm run test:e2e
git diff --check
```

The end-to-end test launches Electron against temporary knowledge and progress paths, exercises the graph and check-in flow, verifies the persisted event, and captures a learning checkpoint without touching personal data.

## Documentation and Support

- [Architecture and data contracts](docs/architecture/closed-loop-learning-system.md)
- [Knowledge authoring workflow](RevemberKnowledge/LEARNING_WORKFLOW.md)
- [MCP server guide](mcp-server/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Released under the [MIT License](LICENSE).
