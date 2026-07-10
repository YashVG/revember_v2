#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
PRODUCT_NAME="RevemberV2"
APP_NAME="Revember"
BUNDLE_ID="com.yashvg.Revember"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
ICON_SOURCE="$ROOT_DIR/docs/brand/revember-app-icon.svg"
ICON_FILE="Revember.icns"

usage() {
  echo "usage: $0 [run|--install|--debug|--logs|--telemetry|--verify]" >&2
}

case "$MODE" in
  run|--install|install|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    usage
    exit 2
    ;;
esac

cd "$ROOT_DIR"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -x "$PRODUCT_NAME" >/dev/null 2>&1 || true

BUILD_CONFIGURATION=()
if [[ "$MODE" == "install" || "$MODE" == "--install" ]]; then
  BUILD_CONFIGURATION=(--configuration release)
fi

swift build --product "$PRODUCT_NAME" "${BUILD_CONFIGURATION[@]}"
BUILD_BINARY="$(swift build --show-bin-path "${BUILD_CONFIGURATION[@]}")/$PRODUCT_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"

generate_icon() {
  [[ -f "$ICON_SOURCE" ]] || return 0

  local iconset="$DIST_DIR/$APP_NAME.iconset"
  local source_png="$DIST_DIR/$(basename "$ICON_SOURCE").png"

  rm -rf "$iconset" "$source_png" "$APP_RESOURCES/$ICON_FILE"
  mkdir -p "$iconset"

  /usr/bin/qlmanage -t -s 1024 -o "$DIST_DIR" "$ICON_SOURCE" >/dev/null 2>&1
  [[ -f "$source_png" ]] || return 0

  /usr/bin/sips -z 16 16 "$source_png" --out "$iconset/icon_16x16.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source_png" --out "$iconset/icon_32x32.png" >/dev/null
  /usr/bin/sips -z 64 64 "$source_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  /usr/bin/sips -z 128 128 "$source_png" --out "$iconset/icon_128x128.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source_png" --out "$iconset/icon_256x256.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source_png" --out "$iconset/icon_512x512.png" >/dev/null
  /usr/bin/sips -z 1024 1024 "$source_png" --out "$iconset/icon_512x512@2x.png" >/dev/null
  /usr/bin/iconutil -c icns "$iconset" -o "$APP_RESOURCES/$ICON_FILE"
}

generate_icon

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIconFile</key>
  <string>$ICON_FILE</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.yashvg.Revember.topic</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>revember</string>
      </array>
    </dict>
  </array>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.education</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

install_app() {
  local install_dir="/Applications"
  if [[ ! -w "$install_dir" ]]; then
    install_dir="$HOME/Applications"
    mkdir -p "$install_dir"
  fi

  local installed_app="$install_dir/$APP_NAME.app"
  rm -rf "$installed_app"
  cp -R "$APP_BUNDLE" "$installed_app"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed_app" >/dev/null 2>&1 || true

  echo "Installed $installed_app"
  /usr/bin/open "$installed_app"
}

case "$MODE" in
  run)
    open_app
    ;;
  --install|install)
    install_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
esac
