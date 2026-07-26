#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$("$ROOT_DIR/script/resolve_packaged_app.sh")"

/usr/bin/codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null
echo "Ad-hoc signed $APP_BUNDLE for local use"
