#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/docs/brand/revember-app-icon.svg"
OUTPUT_DIR="$ROOT_DIR/.build-assets"
ICONSET="$OUTPUT_DIR/Revember.iconset"
SOURCE_PNG="$OUTPUT_DIR/revember-app-icon.svg.png"

rm -rf "$ICONSET"
mkdir -p "$ICONSET"
/usr/bin/qlmanage -t -s 1024 -o "$OUTPUT_DIR" "$SOURCE" >/dev/null 2>&1

for spec in "16:16x16" "32:16x16@2x" "32:32x32" "64:32x32@2x" "128:128x128" "256:128x128@2x" "256:256x256" "512:256x256@2x" "512:512x512" "1024:512x512@2x"; do
  pixels="${spec%%:*}"
  name="${spec#*:}"
  /usr/bin/sips -z "$pixels" "$pixels" "$SOURCE_PNG" --out "$ICONSET/icon_${name}.png" >/dev/null
done

/usr/bin/iconutil -c icns "$ICONSET" -o "$OUTPUT_DIR/Revember.icns"
