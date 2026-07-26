#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${REVEMBER_APP_BUNDLE:-}" ]]; then
  APP_BUNDLE="$REVEMBER_APP_BUNDLE"
else
  case "${REVEMBER_BUILD_ARCH:-$(uname -m)}" in
    arm64|aarch64)
      APP_BUNDLE="$ROOT_DIR/release/mac-arm64/Revember.app"
      ;;
    x86_64|amd64)
      APP_BUNDLE="$ROOT_DIR/release/mac/Revember.app"
      ;;
    *)
      echo "Unsupported macOS build architecture: ${REVEMBER_BUILD_ARCH:-$(uname -m)}" >&2
      exit 1
      ;;
  esac
fi

if [[ ! -x "$APP_BUNDLE/Contents/MacOS/Revember" ]]; then
  echo "Packaged Revember executable was not found at $APP_BUNDLE/Contents/MacOS/Revember" >&2
  exit 1
fi

printf '%s\n' "$APP_BUNDLE"
