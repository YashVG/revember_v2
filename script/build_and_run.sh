#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: $0 [run|--install|--debug|--logs|--telemetry|--verify]" >&2
}

ensure_dependencies() {
  node -e 'const major = Number(process.versions.node.split(".")[0]); if (major !== 22 && major < 24) { console.error(`Revember requires Node.js 22 LTS or Node.js 24+. Current: ${process.version}`); process.exit(1); }'
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
    INSTALL_DIR="${REVEMBER_INSTALL_DIR:-/Applications}"
    if [[ -z "$INSTALL_DIR" || "$INSTALL_DIR" == "/" || "$INSTALL_DIR" == "$HOME" ]]; then
      echo "Refusing unsafe Revember install directory: $INSTALL_DIR" >&2
      exit 1
    fi
    if [[ -z "${REVEMBER_INSTALL_DIR:-}" && ! -w "$INSTALL_DIR" ]]; then
      INSTALL_DIR="$HOME/Applications"
    fi
    mkdir -p "$INSTALL_DIR"
    if [[ ! -w "$INSTALL_DIR" ]]; then
      echo "Revember cannot write to install directory: $INSTALL_DIR" >&2
      exit 1
    fi
    if [[ "${REVEMBER_SKIP_APP_STOP:-0}" != "1" ]]; then
      pkill -x Revember >/dev/null 2>&1 || true
    fi
    rm -rf "$INSTALL_DIR/Revember.app"
    cp -R "$APP_BUNDLE" "$INSTALL_DIR/Revember.app"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$INSTALL_DIR/Revember.app" >/dev/null 2>&1 || true
    echo "Installed $INSTALL_DIR/Revember.app"
    if [[ "${REVEMBER_SKIP_LAUNCH:-0}" != "1" ]]; then
      /usr/bin/open "$INSTALL_DIR/Revember.app"
    fi
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
