

<p align="center">
  <strong>A private, local-first practice layer for turning technical material into deliberate recall.</strong>
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#local-ai-optional">Local AI</a> ·
  <a href="#download-for-macos">Download</a> ·
  <a href="#project-map">Project map</a>
</p>

# Revember

Revember is a macOS desktop app for learners who want a local learning loop: capture or read source material, turn the facts worth retaining into questions, then return to them on a spaced-review schedule. Notes remain readable and editable in the app, while review questions and evidence stay structured.

It is built with Electron, React, and TypeScript. An optional local [Ollama](https://ollama.com/) connection can suggest distractors while keeping the learner in control of every saved change.

<p align="center">
  <a href="https://github.com/YashVG/revember_v2/releases/download/v0.2.0/Revember-0.2.0-arm64.dmg"><strong>Download Revember v0.2.0 for Apple silicon</strong></a>
</p>

> **Status:** macOS prerelease for Apple silicon. The download contains the app, starter Knowledge Vault, and local MCP runtime. It is ad-hoc signed, not Apple-notarized, so macOS requires manual approval on first launch.

## How it works

```text
Notes → readable source sections → authored questions → spaced review → next recall session
```

1. **Capture the material.** Write a learner note or open an existing note under a topic; Revember preserves the original text.
2. **Make a question deliberately.** Start from a note section or the Questions page. Write the sentence, answer, alternatives, and explanation; nothing is auto-saved for you.
3. **Review what matters.** Choose a queue or open a question directly. Revember records the answer and calculates the next review time.

## What is included

- Topic-based concepts, questions, learner notes, and provenance metadata.
- Fill-in-the-blank recall cards with answer explanations and revision-aware scheduling.
- A Notes reader with section navigation for long material.
- Question authoring from a finished note, a topic, or the Questions page.
- A focused queue for due, needs-refresh, new, and scheduled questions.
- Local backups, checkpoints, deep links, tray state, and opt-in reminders.
- A bundled stdio MCP server for revision-checked local knowledge authoring from Codex or Claude Desktop.

## Local AI (optional)

Ollama is an assistive layer, never the source of truth:

- It can propose three plausible distractors for a question.
- Generated text stays editable and requires the normal save action.
- Core question authoring and review still work when Ollama is offline.

To enable the configured local model:

```bash
ollama pull llama3
```

## Download for macOS

[Download the Revember v0.2.0 DMG](https://github.com/YashVG/revember_v2/releases/download/v0.2.0/Revember-0.2.0-arm64.dmg). The DMG contains the complete app; you do not need Node.js, npm, the source repository, or the test suite.

This prerelease supports Apple silicon Macs. It is not Apple-notarized, so macOS requires manual approval on first launch.

### Step-by-step installation

1. Select **Download Revember v0.2.0 for Apple silicon** above.
2. Open `Revember-0.2.0-arm64.dmg` from your Downloads folder.
3. Drag **Revember** into the **Applications** folder shown in the installer window.
4. Eject the Revember installer from Finder.
5. Open **Applications**, Control-click **Revember**, and select **Open**.
6. Confirm **Open** in the macOS warning. If macOS blocks the app, open **System Settings → Privacy & Security**, select **Open Anyway**, then confirm.
7. Wait for Revember to open. The first launch creates an editable starter Vault at `~/Documents/RevemberKnowledge`.

### Connect Codex or Claude through MCP

1. Open **Settings → AI study partner** in Revember.
2. Select **Connect Codex** or **Connect Claude**.
3. Restart that client once.

The MCP process starts on demand and reads the Vault currently selected in Revember. The installed app supplies its runtime, so the MCP client does not need Node.js or a repository path.

## Build from source

Requires Node.js 22 LTS (the CI and `.nvmrc` default) or Node.js 24+, plus npm. Node.js 23 is not supported by the test toolchain.

```bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm run install:app
```

The command installs dependencies, builds the app and MCP runtime, installs `Revember.app` in `/Applications` or `~/Applications`, and opens it. On first launch, Revember copies the starter Vault to `~/Documents/RevemberKnowledge`, so the bundled source files stay unchanged.

For source development instead of a local app install:

```bash
npm run bootstrap
npm run dev
```

## Local data

Supabase provides email/password login and manual cloud
snapshots. Each new account receives separate local storage under Electron's
user-data directory at `accounts/<user-id>/`. Upgrades preserve the existing
account's selected folder and progress path. See [cloud setup and sync behavior](supabase/README.md).

| Location | Contains |
| --- | --- |
| `RevemberKnowledge/topics/` | Versioned concepts, relationships, gaps, and review cards |
| `RevemberKnowledge/notes/` | Authored source explanations for the knowledge store |
| `RevemberKnowledge/captures/` | Exact learner notes and draft/ready capture revisions |
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
| `npm run install:app` | Build, install, and open the local macOS app with its Vault and MCP runtime |
| `npm run dev` | Run the desktop app in development |
| `npm run verify:app` | TypeScript, unit tests, and production build |
| `npm run verify` | Clean-install and verify the app and MCP workspace |
| `npm run test:e2e` | Mocked-account login, isolation, cloud sync, topic, review, and note flows |
| `npm run test:package` | Unpacked macOS app and packaged-app smoke checks |
| `git diff --check` | Whitespace and conflict-marker hygiene |

Create an ad-hoc-signed unpacked macOS app under `release/` with `npm run package`. `npm run dist` packages that app as DMG and ZIP artifacts. A normal public release still requires Apple Developer ID signing and notarization credentials.

The current readiness checks are:

- `npm run verify` — app typecheck, all unit/integration tests, production build, MCP checks, and stdio transport smoke test.
- `npm run test:package` — packaged macOS app build and unpacked-app smoke test.

The full Electron end-to-end flow uses temporary vaults and mocked Supabase responses by default; no credentials are required.
`REVEMBER_E2E_SESSION_PATH` optionally enables the existing live-account read/download journey using a private session file.
Mocked account tests do not replace a hosted Supabase authorization check.

## Project map

| Path | Purpose |
| --- | --- |
| `electron/` | Main process, local persistence, note organization, and native integrations |
| `src/renderer/` | React interfaces for notes, topics, questions, review, and settings |
| `shared/` | Data contracts, validation, scheduling, and queue logic |
| `tests-electron/` | Unit, integration, Electron, and package-smoke coverage |
| `RevemberKnowledge/` | Seed learning material and authoring guidance |
| `mcp-server/` | Bundled local stdio MCP server and packaged-app launcher |
| `docs/architecture/` | Architecture decisions and local-intelligence research |

## Documentation

- [Closed-loop architecture](docs/architecture/closed-loop-learning-system.md)
- [Local intelligence research](docs/architecture/local-intelligence-research.md)
- [Knowledge authoring workflow](RevemberKnowledge/LEARNING_WORKFLOW.md)
- [MCP server guide](mcp-server/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Released under the [MIT License](LICENSE).
