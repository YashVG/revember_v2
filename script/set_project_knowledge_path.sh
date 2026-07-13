#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOWLEDGE_ROOT="$PROJECT_ROOT/RevemberKnowledge"
SETTINGS_PATH="$HOME/Library/Application Support/Revember/settings.json"

if [[ ! -d "$KNOWLEDGE_ROOT/topics" || ! -d "$KNOWLEDGE_ROOT/notes" ]]; then
  echo "Expected a RevemberKnowledge folder at: $KNOWLEDGE_ROOT" >&2
  exit 1
fi

node - "$SETTINGS_PATH" "$KNOWLEDGE_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [settingsPath, knowledgeRootPath] = process.argv.slice(2);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
settings.knowledgeRootPath = knowledgeRootPath;
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
NODE

echo "Revember will use: $KNOWLEDGE_ROOT"
