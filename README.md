<p align="center">
  <img src="docs/brand/revember-logo.svg" alt="Revember" width="512">
</p>

<p align="center">
  <strong>A local-first macOS learning app that turns technical notes into evidence-backed review.</strong>
</p>

# Revember

Revember keeps technical learning durable without an account or cloud backend. It stores source notes, authored concepts, review history, and schedules as readable local files. An optional local Ollama model can extract a grounded study response after the learner finishes a lecture.

The desktop app uses Electron, React, and TypeScript. The optional Model Context Protocol (MCP) server lets compatible local clients author knowledge and read learner evidence through the same versioned files.

**Status:** active pre-release development. The repository builds and packages a macOS app, but it does not yet publish a signed or notarized release.

## Product Workflow

1. **Capture:** Today autosaves the exact lecture text as a local draft. Autosave does not call a model.
2. **Finish:** **Finish lecture** marks the current revision ready and starts one optional local `llama3` analysis.
3. **Review:** Check-In and the due queue persist revision-bound answers and schedule the next retrieval.
4. **Inspect:** Concept Map and Graph separate authored knowledge from learner evidence.
5. **Close the loop:** The stdio MCP server can read weak concepts and update versioned learning material.

Local AI output is stored separately from the original note. Revember reconstructs takeaways from exact source segments and never lets model output overwrite the learner's text.

## Run on macOS

Requires Node.js 22 LTS (the CI and `.nvmrc` default) or Node.js 24+, plus npm. Node.js 23 is not supported by the test toolchain.

```bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm ci
./script/set_project_knowledge_path.sh
npm run dev
```

This app-only quick start installs the root lockfile. The repository includes two seed technical topics under `RevemberKnowledge/`. Run `npm run bootstrap` when you need both the app and optional MCP workspaces.

### Optional local study response

Install [Ollama](https://ollama.com/), start its local service, and install the configured model:

```bash
ollama pull llama3
```

Revember continues to save and review notes when Ollama is absent. It shows a retryable unavailable state instead of downloading or starting a model automatically.

## Current Features

- Draft lecture-note autosave with explicit Finish Lecture analysis.
- Grounded local `llama3` responses stored by note revision.
- Revision-aware spaced repetition with an append-only review-event ledger.
- Diagnostic cards with source provenance, answer rationales, and misconception IDs.
- Authored concept relationships plus learner-evidence graph views.
- Live topic reload that preserves the last valid snapshot during partial edits.
- Local checkpoints, backups, tray state, deep links, and opt-in reminders.
- Optional stdio MCP tools for atomic, revision-checked knowledge authoring.

## Local Data

`RevemberKnowledge/` is a safe seed store. Copy it before adding private material, then select the copy in Settings:

```bash
cp -R RevemberKnowledge "$HOME/Documents/RevemberKnowledge"
```

| Local artifact | Purpose |
| --- | --- |
| `topics/*.json` | Versioned concepts, relationships, gaps, and review cards |
| `notes/*.md` | Authored source explanations |
| `captures/*.json` | Exact learner notes and user-authored takeaways |
| `capture-enrichments/*.json` | Optional revision-keyed local model output |
| `sessions/*.json` | Learning checkpoints |
| `~/Library/Application Support/RevemberV2/progress.json` | Review events and derived schedules |

Development and MCP clients can override both roots:

```bash
export REVEMBER_KNOWLEDGE_ROOT="/absolute/path/to/RevemberKnowledge"
export REVEMBER_PROGRESS_PATH="$HOME/Library/Application Support/RevemberV2/progress.json"
```

## Build and Verify

| Command | Verifies |
| --- | --- |
| `npm run verify:app` | TypeScript, unit tests, and production build using installed root dependencies |
| `npm run verify` | Clean-install both lockfiles, then run app and MCP build/tests/stdio smoke |
| `npm run test:e2e` | Real Electron graph, review, persistence, and checkpoint workflow |
| `npm run build && node tests-electron/local-ai-e2e.mjs` | Finish Lecture through a deterministic fake Ollama endpoint, exact-source rendering, and persistence |
| `npm run test:package` | Unpacked macOS app plus packaged-app smoke checks |
| `git diff --check` | Whitespace and conflict-marker hygiene |

Run the full local release gate with:

```bash
npm run verify
npm run test:e2e
npm run test:e2e
node tests-electron/local-ai-e2e.mjs
npm run test:package
git diff --check
```

The two consecutive primary workflow runs are intentional: they catch startup, persistence, and interaction races that a single pass can miss.
The full `npm run verify` gate begins with deterministic `npm ci` installs for the root app and `mcp-server/`. Use `npm run verify:app` for fast app-only reruns after setup.

Create an unpacked macOS app under `release/` with `npm run package`. Install that local build with:

```bash
./script/build_and_run.sh --install
```

`npm run dist` creates DMG and ZIP artifacts. Public distribution still requires Apple signing and notarization credentials.

## Repository Map

| Path | Purpose |
| --- | --- |
| `electron/` | Main process, persistence, local AI coordination, filesystem watching, and native integrations |
| `src/renderer/` | React Today, notes, graph, review, authoring, and settings interfaces |
| `shared/` | Data contracts, validation, scheduling, queues, and graph derivation |
| `tests-electron/` | Unit, integration, Electron end-to-end, and package smoke tests |
| `RevemberKnowledge/` | Seed Markdown and schema-v2 learning content |
| `mcp-server/` | Optional local stdio MCP server |
| `docs/architecture/` | Data contracts, local AI decisions, and research records |

## Documentation

- [Closed-loop architecture](docs/architecture/closed-loop-learning-system.md)
- [Local note enrichment](docs/architecture/local-note-enrichment.md)
- [Local intelligence research record](docs/architecture/local-intelligence-research.md)
- [Knowledge authoring workflow](RevemberKnowledge/LEARNING_WORKFLOW.md)
- [MCP server guide](mcp-server/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Released under the [MIT License](LICENSE).
