#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOWLEDGE_ROOT="$PROJECT_ROOT/RevemberKnowledge"

if [[ ! -d "$KNOWLEDGE_ROOT/topics" || ! -d "$KNOWLEDGE_ROOT/notes" ]]; then
  echo "Expected a RevemberKnowledge folder at: $KNOWLEDGE_ROOT" >&2
  exit 1
fi

defaults write com.yashvg.Revember knowledgeRootPath "$KNOWLEDGE_ROOT"
echo "Revember will use: $KNOWLEDGE_ROOT"
