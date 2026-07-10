# Revember v2

Revember is a local-first macOS learning app for turning first-principles sessions into evidence-backed review. It stores authored knowledge as readable Markdown and JSON, records review evidence locally, and schedules the next retrieval without a backend, login, or cloud account.

## What's Included

- A native macOS app, Swift package, and Xcode project.
- A seed `RevemberKnowledge/` folder with a BLE lesson in Markdown and schema-v2 JSON.
- A local stdio MCP server for inspecting and revising knowledge safely.
- A transparent review scheduler with an explicit seam for a future FSRS implementation.

Review progress lives only on the local machine at `~/Library/Application Support/RevemberV2/progress.json` by default.

## Requirements

- macOS 14 or later
- Xcode 16 or a Swift 6 toolchain
- Node.js 20 or later (for the optional MCP server)

The app build script also uses standard macOS tools: `qlmanage`, `sips`, `iconutil`, `codesign`, and `open`.

## Quick Start

```bash
git clone https://github.com/YashVG/revember_v2.git
cd revember_v2
npm --prefix mcp-server ci
./script/set_project_knowledge_path.sh
swift test
npm --prefix mcp-server run check
./script/build_and_run.sh
```

The setup script points the app at this checkout's seed knowledge store. To maintain private personal learning material, copy `RevemberKnowledge/` somewhere writable and select it in the app's Settings instead. You can also set `REVEMBER_KNOWLEDGE_ROOT` when launching the app or MCP server outside the normal setup flow.

Open `Revember.xcodeproj` in Xcode to work with the app, core framework, and test targets directly.

## Repository Guide

| Path | Purpose |
| --- | --- |
| `Sources/` | App and core learning logic |
| `Tests/` | Swift test suite |
| `RevemberKnowledge/` | Seed authored knowledge; generated backups and personal sessions are ignored |
| `mcp-server/` | Optional local stdio MCP server |
| `docs/architecture/` | Data flow and system contracts |
| `script/` | Local build and setup helpers |

The end-to-end data flow and contracts are documented in [the closed-loop learning architecture](docs/architecture/closed-loop-learning-system.md).

## Verify Changes

```bash
swift test
npm --prefix mcp-server run check
git diff --check
```

For an Xcode build without signing:

```bash
xcodebuild -project Revember.xcodeproj -scheme Revember -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

## Optional MCP Server

The `revember` server is a local stdio MCP server; it works with Codex, Claude Desktop, or another MCP-compatible client. It defaults to the checked-in `RevemberKnowledge/` folder and never contacts a remote service.

Build and validate it with:

```bash
npm --prefix mcp-server ci
npm --prefix mcp-server run check
```

See [the MCP server guide](mcp-server/README.md) for client configuration, resources, mutation tools, revision checks, and session artifacts.

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local workflow and [SECURITY.md](SECURITY.md) for responsible disclosure guidance.

## License

Released under the [MIT License](LICENSE).
