# Revember

Revember is a local-first macOS app that turns technical material into a small, deliberate recall practice. It keeps notes, questions, and review history on the learner's machine.

## Status

This is a portfolio-ready local demo. The supported release surface is macOS. Builds are ad-hoc signed for local use; public distribution would still require Apple signing and notarization.

The app does not require an account or cloud storage. An optional local [Ollama](https://ollama.com/) connection can suggest wrong answers. Suggestions stay editable and save only when the learner saves the question.

## How it works

1. Open **Today** and start the questions ready for recall.
2. Answer one multiple-choice question at a time. Revember records the result and schedules the next review.
3. Use **Questions** to start the review dock, practice one question, or open its topic context.
4. Add a question as either a fill-in-the-blank statement or a direct question. Both styles keep a separate answer, plausible alternatives, and an optional explanation.

Review always returns to the place that started it. Notes remain readable and editable; authored questions and review events remain local.

## Run on macOS

Requires Node.js 22 LTS (or Node.js 24+) and npm. Node.js 23 is unsupported by the test toolchain.

~~~bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm ci
npm run dev
~~~

On first launch, Revember automatically creates an editable `RevemberKnowledge` folder in your Documents directory from the starter vault included in this repository. You can begin reviewing immediately—no folder setup or terminal commands are required after the app starts. Use Settings only if you later want to switch to another learning folder.

If you use Codex or Claude Desktop, open **Settings → AI study partner** and choose **Connect Codex** or **Connect Claude**. Revember registers its bundled local MCP server; it follows the learning folder currently open in the app. Restart the selected client once, then it can read and safely author your notes and questions without a separate Node installation.

Run npm run bootstrap when you also need the optional MCP workspace.

## Verify

~~~bash
npm run verify
npm run test:e2e
npm run test:package
git diff --check
~~~

npm run verify performs clean installs, typechecks the app, runs its tests, builds the renderer, and checks the optional MCP server. npm run test:e2e verifies the Electron flow. npm run test:package builds an unpacked macOS app and performs a packaged-app smoke test.

npm run package writes a local unpacked app to release/. npm run dist also creates DMG and ZIP artifacts.

## Project map

| Path | Purpose |
| --- | --- |
| electron/ | Main process, local persistence, native integration, and IPC handlers |
| src/renderer/ | React screens for Today, Notes, Questions, review, and Settings |
| shared/ | Typed data contracts, validation, scheduling, and queue logic |
| tests-electron/ | Unit, integration, Electron, and package-smoke coverage |
| RevemberKnowledge/ | Seeded local learning material and authoring guidance |
| mcp-server/ | Optional stdio server for revision-checked local authoring |

## Documentation

- [Current product QA](design-qa.md)
- [Closed-loop architecture](docs/architecture/closed-loop-learning-system.md)
- [Knowledge authoring workflow](RevemberKnowledge/LEARNING_WORKFLOW.md)
- [MCP server guide](mcp-server/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Released under the [MIT License](LICENSE).
