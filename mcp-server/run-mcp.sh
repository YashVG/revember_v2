#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGED_ELECTRON="$SCRIPT_DIR/../../MacOS/Revember"

if [[ -x "$PACKAGED_ELECTRON" ]]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "$PACKAGED_ELECTRON" "$SCRIPT_DIR/packaged-entry.mjs"
fi

exec node "$SCRIPT_DIR/dist/index.js"
