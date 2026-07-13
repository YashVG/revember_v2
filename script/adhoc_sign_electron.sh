#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$(find "$ROOT_DIR/release" -type d -name Revember.app -prune -print -quit)"

if [[ -z "$APP_BUNDLE" ]]; then
  echo "Packaged Revember.app was not found under $ROOT_DIR/release" >&2
  exit 1
fi

/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
echo "Ad-hoc signed $APP_BUNDLE for local use"
