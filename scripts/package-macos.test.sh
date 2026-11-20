#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cove_package_dir="$(mktemp -d "${TMPDIR:-/tmp}/cove-package-test.XXXXXX")"
cove_test_data="$(mktemp -d "${TMPDIR:-/tmp}/cove-package-home.XXXXXX")"
cove_mount_attached=0
cove_launcher_pid=""
cove_service_pid=""
cove_build_resources=""
cove_saved_resources=""

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'package-macos.test: required command not found: %s\n' "$1" >&2
    exit 1
  }
}

stop_process() {
  cove_process_pid="$1"
  [ -n "$cove_process_pid" ] || return 0
  kill "$cove_process_pid" >/dev/null 2>&1 || true
  cove_attempt=0
  while kill -0 "$cove_process_pid" >/dev/null 2>&1 && [ "$cove_attempt" -lt 10 ]; do
    cove_attempt=$((cove_attempt + 1))
    sleep 1
  done
  ! kill -0 "$cove_process_pid" >/dev/null 2>&1
}

stop_launched_app() {
  stop_process "$cove_service_pid"
  cove_service_pid=""
  stop_process "$cove_launcher_pid"
  cove_launcher_pid=""
}

detach_mount() {
  cove_attempt=0
  while [ "$cove_attempt" -lt 10 ]; do
    if hdiutil detach "$cove_mount" >/dev/null 2>&1; then
      cove_mount_attached=0
      return
    fi
    cove_attempt=$((cove_attempt + 1))
    sleep 1
  done
  return 1
}

cleanup() {
  stop_launched_app || true
  if [ "$cove_mount_attached" -eq 1 ]; then
    detach_mount || true
  fi
  if [ -n "$cove_saved_resources" ] && [ -d "$cove_saved_resources" ]; then
    mv "$cove_saved_resources" "$cove_build_resources"
  fi
  rm -rf "$cove_package_dir" "$cove_test_data"
}

trap cleanup EXIT INT TERM

require_command curl
require_command lsof
require_command sqlite3

if COVE_PACKAGE_DIR="$cove_package_dir" COVE_RELEASE=1 COVE_INSECURE_FILE_SECRET_STORE=1 "$cove_root/scripts/package-macos.sh" >"$cove_package_dir/insecure-release.log" 2>&1; then
  printf '%s\n' 'package-macos.test: insecure file secrets must be rejected for release builds' >&2
  exit 1
fi
grep -q 'COVE_RELEASE=1 cannot use COVE_INSECURE_FILE_SECRET_STORE=1' "$cove_package_dir/insecure-release.log"

cove_data_dir="$cove_test_data"
mkdir -p "$cove_data_dir"
sqlite3 "$cove_data_dir/cove.sqlite" <<'SQL'
CREATE TABLE package_acceptance_marker (value TEXT NOT NULL);
INSERT INTO package_acceptance_marker (value) VALUES ('preserve-this-database');
SQL

# This acceptance fixture intentionally exercises the locally ad-hoc-signed
# package path. Release workflows export COVE_RELEASE=1 for their notarized
# artifact, so reset it here rather than accidentally applying release
# credential requirements to this isolated development-package check.
COVE_PACKAGE_DIR="$cove_package_dir" COVE_RELEASE=0 COVE_INSECURE_FILE_SECRET_STORE=1 COVE_SIGNING_IDENTITY='' COVE_NOTARIZE=0 "$cove_root/scripts/package-macos.sh" >/dev/null
cove_app="$cove_package_dir/Cove.app"
cove_version="$(plutil -extract CoveReleaseVersion raw -o - "$cove_root/apps/macos/Resources/Info.plist")"
cove_dmg="$cove_package_dir/Cove-$cove_version-arm64.dmg"
cove_mount="$cove_package_dir/mount"

test -x "$cove_app/Contents/MacOS/Cove"
test -x "$cove_app/Contents/Resources/cove-local-service"
test -d "$cove_app/Contents/Resources/CoveLauncher_CoveLauncherApp.bundle"
test -f "$cove_app/Contents/Resources/CoveLauncher_CoveLauncherApp.bundle/CoveMenuBarTemplate.png"
test -f "$cove_app/Contents/Resources/CoveLauncher_CoveLauncherApp.bundle/CoveMenuBarTemplate@2x.png"
test -f "$cove_app/Contents/Resources/AppIcon.icns"
test -f "$cove_dmg"
test -f "$cove_dmg.sha256"

test "$(file -b "$cove_app/Contents/MacOS/Cove")" = "Mach-O 64-bit executable arm64"
test "$(file -b "$cove_app/Contents/Resources/cove-local-service")" = "Mach-O 64-bit executable arm64"
test "$(plutil -extract CFBundleIdentifier raw -o - "$cove_app/Contents/Info.plist")" = "io.github.tokenfunplus.cove"
test "$(plutil -extract CFBundlePackageType raw -o - "$cove_app/Contents/Info.plist")" = "APPL"
test "$(plutil -extract LSMinimumSystemVersion raw -o - "$cove_app/Contents/Info.plist")" = "13.0"
test "$(plutil -extract CFBundleShortVersionString raw -o - "$cove_app/Contents/Info.plist")" = "$(plutil -extract CFBundleShortVersionString raw -o - "$cove_root/apps/macos/Resources/Info.plist")"
test "$(plutil -extract CoveReleaseVersion raw -o - "$cove_app/Contents/Info.plist")" = "$cove_version"
test "$(plutil -extract CFBundleIconFile raw -o - "$cove_app/Contents/Info.plist")" = "AppIcon.icns"
test "$(plutil -extract CoveInsecureFileSecretStore raw -o - "$cove_app/Contents/Info.plist")" = "true"
test "$(sqlite3 "$cove_data_dir/cove.sqlite" 'SELECT value FROM package_acceptance_marker;')" = "preserve-this-database"
codesign --verify --strict "$cove_app/Contents/Resources/cove-local-service"
codesign --verify --deep --strict "$cove_app"
codesign --display --verbose=4 "$cove_app" 2>&1 | grep -q '^Signature=adhoc$'

(cd "$cove_package_dir" && shasum -a 256 -c "$(basename "$cove_dmg.sha256")")
test "$(hdiutil imageinfo "$cove_dmg" | awk -F': ' '/^Format: / { print $2; exit }')" = "UDZO"
mkdir "$cove_mount"
hdiutil attach -readonly -nobrowse -mountpoint "$cove_mount" "$cove_dmg" >/dev/null
cove_mount_attached=1
test -x "$cove_mount/Cove.app/Contents/MacOS/Cove"
test -d "$cove_mount/Cove.app/Contents/Resources/CoveLauncher_CoveLauncherApp.bundle"
test -f "$cove_mount/Cove.app/Contents/Resources/AppIcon.icns"
test "$(readlink "$cove_mount/Applications")" = /Applications
test -f "$cove_mount/.DS_Store"
test -f "$cove_mount/.background.tiff"
codesign --verify --deep --strict "$cove_mount/Cove.app"

# An installed app cannot fall back to resources in its original build tree.
# Restore this directory even when startup or later assertions fail.
cove_swift_build="$(cd "$cove_root/apps/macos" && swift build -c release --show-bin-path)"
cove_build_resources="$cove_swift_build/CoveLauncher_CoveLauncherApp.bundle"
cove_saved_resources="$cove_package_dir/build-resources.bundle"
mv "$cove_build_resources" "$cove_saved_resources"

COVE_DATA_DIR="$cove_test_data" COVE_PACKAGE_ACCEPTANCE_TEST=1 "$cove_mount/Cove.app/Contents/MacOS/Cove" >"$cove_package_dir/launcher.log" 2>&1 &
cove_launcher_pid=$!
cove_attempt=0
cove_listener=""
cove_ready=0
cove_launch_url=""
while [ "$cove_attempt" -lt 40 ]; do
  if ! kill -0 "$cove_launcher_pid" >/dev/null 2>&1; then
    cat "$cove_package_dir/launcher.log" >&2
    exit 1
  fi
  cove_service_pid="$(ps -axo pid=,ppid=,command= | awk -v parent="$cove_launcher_pid" '$2 == parent && $3 ~ /\/cove-local-service$/ { print $1; exit }')"
  if [ -n "$cove_service_pid" ]; then
    cove_service_command="$(ps -p "$cove_service_pid" -o command=)"
    case "$cove_service_command" in
      *--insecure-file-secret-store*) ;;
      *) cat "$cove_package_dir/launcher.log" >&2; exit 1 ;;
    esac
    cove_listener="$(lsof -nP -a -p "$cove_service_pid" -iTCP -sTCP:LISTEN | awk 'NR > 1 { print $9; exit }')"
    cove_port="${cove_listener##*:}"
    if [ "${cove_listener%:*}" = "127.0.0.1" ] &&
       [ "$cove_port" -ge 19421 ] &&
       [ "$cove_port" -le 19521 ]; then
      cove_ready=1
    fi
  fi
  cove_launch_url="$(sed -n 's/^COVE_PACKAGE_ACCEPTANCE_BROWSER_URL=//p' "$cove_package_dir/launcher.log" | tail -n 1)"
  if [ "$cove_ready" -eq 1 ] && [ -n "$cove_launch_url" ]; then
    break
  fi
  cove_attempt=$((cove_attempt + 1))
  sleep 1
done
if [ "$cove_ready" -ne 1 ] || [ -z "$cove_launch_url" ]; then
  cat "$cove_package_dir/launcher.log" >&2
  exit 1
fi
case "$cove_launch_url" in
  "http://$cove_listener"/launch?token=*) ;;
  *) cat "$cove_package_dir/launcher.log" >&2; exit 1 ;;
esac
cove_session_location="$(curl --fail --silent --show-error --connect-timeout 1 --max-time 2 \
  --output /dev/null --write-out '%{redirect_url}' "$cove_launch_url")"
case "$cove_session_location" in
  "http://$cove_listener"/#cove-session=*) ;;
  *) printf '%s\n' 'Launcher did not issue a browser session fragment' >&2; exit 1 ;;
esac
cove_session_token="${cove_session_location##*#cove-session=}"
printf 'header = "X-Cove-Session-Token: %s"\n' "$cove_session_token" |
  curl --config - --fail --silent --show-error --connect-timeout 1 --max-time 2 \
    "http://$cove_listener/api/session" > /dev/null
curl --fail --silent --show-error --connect-timeout 1 --max-time 2 \
  "http://$cove_listener/" >"$cove_package_dir/chat-surface.html"
grep -q 'id="root"' "$cove_package_dir/chat-surface.html"
test "$(sqlite3 "$cove_data_dir/cove.sqlite" 'SELECT value FROM package_acceptance_marker;')" = "preserve-this-database"

stop_launched_app
detach_mount

printf '%s\n' 'macOS package structure passed'
