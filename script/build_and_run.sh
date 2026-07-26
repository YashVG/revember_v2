#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: $0 [run|--install|--debug|--logs|--telemetry|--verify]" >&2
}

ensure_dependencies() {
  if [[ ! -x "$ROOT_DIR/node_modules/.bin/electron-vite" || ! -f "$ROOT_DIR/node_modules/electron/path.txt" ]]; then
    npm ci
  fi
}

cd "$ROOT_DIR"

case "$MODE" in
  run)
    ensure_dependencies
    exec npm run dev
    ;;
  --install|install)
    ensure_dependencies
    npm run package
    APP_BUNDLE="$("$ROOT_DIR/script/resolve_packaged_app.sh")"
    INSTALL_DIR="/Applications"
    if [[ ! -w "$INSTALL_DIR" ]]; then
      INSTALL_DIR="$HOME/Applications"
      mkdir -p "$INSTALL_DIR"
    fi
    pkill -x Revember >/dev/null 2>&1 || true
    rm -rf "$INSTALL_DIR/Revember.app"
    cp -R "$APP_BUNDLE" "$INSTALL_DIR/Revember.app"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$INSTALL_DIR/Revember.app" >/dev/null 2>&1 || true
    echo "Installed $INSTALL_DIR/Revember.app"
    /usr/bin/open "$INSTALL_DIR/Revember.app"
    ;;
  --debug|debug)
    ensure_dependencies
    ELECTRON_ENABLE_LOGGING=1 exec npm run dev
    ;;
  --logs|logs|--telemetry|telemetry)
    /usr/bin/open -a Revember >/dev/null 2>&1 || true
    exec /usr/bin/log stream --info --style compact --predicate 'process == "Revember"'
    ;;
  --verify|verify)
    npm run verify
    node tests-electron/e2e.mjs
    ;;
  *)
    usage
    exit 2
    ;;
esac
