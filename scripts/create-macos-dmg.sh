#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fail() {
  printf 'create-macos-dmg: %s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 2 ] || fail 'Usage: create-macos-dmg.sh SOURCE_APP OUTPUT_DMG'
[ "$(uname -s)" = Darwin ] || fail 'macOS is required'
cove_app="$1"
cove_dmg="$2"
[ -f "$cove_app/Contents/Info.plist" ] || fail 'The source app has no Info.plist'
[ "$(basename "$cove_app")" = Cove.app ] || fail 'The source bundle must be named Cove.app'
cove_python="$cove_root/.artifacts/dmg-tools/bin/python"
[ -x "$cove_python" ] || fail 'Install DMG tools first; see docs/releasing.md'
"$cove_python" -c 'from importlib.metadata import version; assert version("dmgbuild") == "1.6.7"' || fail 'Reinstall the pinned DMG tools; see docs/releasing.md'
cove_version="$(plutil -extract CoveReleaseVersion raw -o - "$cove_app/Contents/Info.plist")"
cove_stage="$(mktemp -d "${TMPDIR:-/tmp}/cove-dmg-layout.XXXXXX")"
cove_mounted=0
cleanup() {
  cove_status=$?
  trap - EXIT
  if [ "$cove_mounted" = 1 ]; then
    hdiutil detach "$cove_stage/mount" >/dev/null || cove_status=1
  fi
  if [ "$cove_status" -ne 0 ]; then rm -f "$cove_dmg"; fi
  rm -rf "$cove_stage"
  exit "$cove_status"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# Render both resolutions before creating the image. Finder is never automated.
swift -module-cache-path "$cove_root/.artifacts/dmg-tools/module-cache" "$cove_root/scripts/render-dmg-background.swift" "$cove_stage"
"$cove_root/.artifacts/dmg-tools/bin/dmgbuild" \
  -s "$cove_root/scripts/dmg-settings.py" \
  -D "app=$cove_app" -D "background=$cove_stage/background.png" \
  "Cove $cove_version" "$cove_dmg"

# dmgbuild may ignore a failed app copy. Verify the actual image before callers
# produce checksums or submit it for notarization.
mkdir "$cove_stage/mount"
hdiutil attach -readonly -nobrowse -mountpoint "$cove_stage/mount" "$cove_dmg" >/dev/null
cove_mounted=1
codesign --verify --deep --strict "$cove_stage/mount/Cove.app"
hdiutil detach "$cove_stage/mount" >/dev/null
cove_mounted=0
