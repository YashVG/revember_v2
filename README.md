<p align="center">
  <img src="docs/brand/revember-logo.svg" alt="Revember" width="512">
</p>

<p align="center">
  <strong>A private, local-first learning workspace for turning technical notes into deliberate recall practice.</strong>
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#local-ai-optional">Local AI</a> ·
  <a href="#run-on-macos">Run locally</a> ·
  <a href="#project-map">Project map</a>
</p>

# Revember

Revember is a macOS desktop app for learners who want to keep the full loop local: write or import notes, make the facts worth retaining into questions, and return to them on a spaced-review schedule. There is no account or cloud backend; source notes, topic material, and review history stay in readable local files.

It is built with Electron, React, and TypeScript. An optional local [Ollama](https://ollama.com/) connection can organize long notes and suggest distractors while keeping the learner in control of every saved change.

> **Status:** active pre-release development. Revember can be built and packaged locally for macOS; signed and notarized public releases are not available yet.

## How it works

```text
Notes → readable source sections → authored questions → spaced review → next recall session
```

1. **Keep the source.** Create a note under a topic; Revember preserves the exact original text.
2. **Read without the scroll tax.** Long notes are split into focused sections, with an immediate deterministic fallback when local AI is unavailable.
3. **Make a question deliberately.** Start from any visible note section or from the Questions page. Write the sentence, answer, alternatives, and explanation; nothing is auto-saved for you.
4. **Review what matters.** Choose a queue or open a question directly. Revember records the answer and calculates the next review time.

## What is included

- Topic-based concepts, questions, and concise source notes.
- Notes reader with section navigation for long material.
- Fill-in-the-blank recall cards with answer explanations and revision-aware scheduling.
- Question authoring from a topic or a selected note section.
- A focused queue for due, new, and scheduled questions.
- Local backups, checkpoints, deep links, tray state, and opt-in reminders.
- An optional stdio MCP server for revision-checked local knowledge authoring.

## Local AI (optional)

Ollama is an assistive layer, never the source of truth:

- It can organize a long note into labelled reading sections.
- It can create a topic note and propose three plausible distractors for a question.
- Generated text stays editable and requires the normal save action.
- Your original note is never overwritten. Core note-taking, authoring, and review still work when Ollama is offline.

To enable the configured local model:

```bash
ollama pull llama3
```

## Run on macOS

Requires Node.js 22 LTS (the CI and `.nvmrc` default) or Node.js 24+, plus npm. Node.js 23 is not supported by the test toolchain.

```bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm ci
./script/set_project_knowledge_path.sh
npm run dev
```

The quick start uses the seeded topics in `RevemberKnowledge/`. To use private material, copy that directory first and select the copy in Settings:

```bash
cp -R RevemberKnowledge "$HOME/Documents/RevemberKnowledge"
```

For the optional MCP workspace as well:

```bash
npm run bootstrap
```

## Local data

| Location | Contains |
| --- | --- |
| `RevemberKnowledge/topics/` | Versioned concepts, relationships, gaps, and review cards |
| `RevemberKnowledge/notes/` | Authored source explanations |
| `RevemberKnowledge/captures/` | Exact learner notes and locally generated topic notes |
| `RevemberKnowledge/capture-segmentations/` | Revision-keyed note reading sections |
| `RevemberKnowledge/sessions/` | Learning checkpoints |
| `~/Library/Application Support/RevemberV2/progress.json` | Review events and derived schedules |

Development and MCP clients can override the knowledge and progress roots:

```bash
export REVEMBER_KNOWLEDGE_ROOT="/absolute/path/to/RevemberKnowledge"
export REVEMBER_PROGRESS_PATH="$HOME/Library/Application Support/RevemberV2/progress.json"
```

## Build and verify

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the desktop app in development |
| `npm run verify:app` | TypeScript, unit tests, and production build |
| `npm run verify` | Clean-install and verify the app and optional MCP workspace |
| `npm run test:e2e` | Electron topic, review, persistence, and checkpoint flow |
| `npm run test:package` | Unpacked macOS app and packaged-app smoke checks |
| `git diff --check` | Whitespace and conflict-marker hygiene |

Create an unpacked macOS app under `release/` with `npm run package`. `npm run dist` creates DMG and ZIP artifacts; public distribution still needs Apple signing and notarization credentials.

## Project map

| Path | Purpose |
| --- | --- |
| `electron/` | Main process, local persistence, note organization, and native integrations |
| `src/renderer/` | React interfaces for notes, topics, questions, review, and settings |
| `shared/` | Data contracts, validation, scheduling, and queue logic |
| `tests-electron/` | Unit, integration, Electron, and package-smoke coverage |
| `RevemberKnowledge/` | Seed learning material and authoring guidance |
| `mcp-server/` | Optional local stdio MCP server |
| `docs/architecture/` | Architecture decisions and local-intelligence research |

## Documentation

- [Closed-loop architecture](docs/architecture/closed-loop-learning-system.md)
- [Local intelligence research](docs/architecture/local-intelligence-research.md)
- [Knowledge authoring workflow](RevemberKnowledge/LEARNING_WORKFLOW.md)
- [MCP server guide](mcp-server/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Released under the [MIT License](LICENSE).
