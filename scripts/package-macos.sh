#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cove_package_dir="${COVE_PACKAGE_DIR:-$cove_root/.artifacts}"
cove_app="$cove_package_dir/Cove.app"
cove_version=""
cove_marketing_version=""
cove_dmg=""
cove_dmg_checksum=""
cove_release="${COVE_RELEASE:-0}"
cove_insecure_file_secret_store="${COVE_INSECURE_FILE_SECRET_STORE:-0}"

fail() {
  printf 'package-macos: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

plist_value() {
  plutil -extract "$2" raw -o - "$1"
}

create_app_icon() {
  cove_icon_source="$cove_root/apps/macos/Resources/AppIcon.svg"
  cove_iconset="$cove_package_dir/AppIcon.iconset"
  cove_icon="$cove_app/Contents/Resources/AppIcon.icns"

  test -f "$cove_icon_source" || fail "application icon source is missing: $cove_icon_source"
  rm -rf "$cove_iconset"
  mkdir -p "$cove_iconset"

  for cove_icon_size in 16 32 128 256 512; do
    sips -s format png -z "$cove_icon_size" "$cove_icon_size" "$cove_icon_source" --out "$cove_iconset/icon_${cove_icon_size}x${cove_icon_size}.png" >/dev/null
    cove_icon_double_size=$((cove_icon_size * 2))
    sips -s format png -z "$cove_icon_double_size" "$cove_icon_double_size" "$cove_icon_source" --out "$cove_iconset/icon_${cove_icon_size}x${cove_icon_size}@2x.png" >/dev/null
  done
  iconutil -c icns "$cove_iconset" -o "$cove_icon"
  rm -rf "$cove_iconset"
}

assert_arm64() {
  cove_file="$1"
  cove_description="$(file -b "$cove_file")"
  case "$cove_description" in
    *arm64*) ;;
    *) fail "$cove_file is not an arm64 executable: $cove_description" ;;
  esac
}

assert_deployment_target() {
  cove_binary_minimum="$(otool -l "$1" | awk '
    /LC_BUILD_VERSION/ { kind=1 }
    /LC_VERSION_MIN_MACOSX/ { kind=2 }
    kind==1 && $1=="minos" { print $2; exit }
    kind==2 && $1=="version" { print $2; exit }
  ')"
  test -n "$cove_binary_minimum" || fail "Cannot read deployment target: $1"
  awk -v actual="$cove_binary_minimum" -v expected="$cove_minimum" 'BEGIN {
    split(actual, a, "[.]"); split(expected, e, "[.]");
    for (i=1; i<=3; i++) if (a[i]+0 != e[i]+0) exit (a[i]+0 > e[i]+0);
    exit 0;
  }' || fail "$1 requires macOS $cove_binary_minimum instead of the advertised $cove_minimum"
}

assert_plist_value() {
  cove_key="$1"
  cove_expected="$2"
  cove_actual="$(plutil -extract "$cove_key" raw -o - "$cove_app/Contents/Info.plist" 2>/dev/null || true)"
  test "$cove_actual" = "$cove_expected" || fail "Info.plist $cove_key = $cove_actual, want $cove_expected"
}

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  fail "Cove packages must be built on an Apple Silicon Mac"
fi

require_command pnpm
require_command file
require_command plutil
require_command swift
require_command "$cove_root/scripts/go"
require_command hdiutil
require_command iconutil
require_command sips
require_command shasum
require_command otool

case "$cove_release" in
  0|1) ;;
  *) fail 'COVE_RELEASE must be 0 or 1' ;;
esac
case "$cove_insecure_file_secret_store" in
  0|1) ;;
  *) fail 'COVE_INSECURE_FILE_SECRET_STORE must be 0 or 1' ;;
esac
if [ "$cove_release" = "1" ] && [ "$cove_insecure_file_secret_store" = "1" ]; then
  fail 'COVE_RELEASE=1 cannot use COVE_INSECURE_FILE_SECRET_STORE=1'
fi

mkdir -p "$cove_package_dir"
rm -rf "$cove_app"
mkdir -p "$cove_app/Contents/MacOS" "$cove_app/Contents/Resources"

cove_version="$(plist_value "$cove_root/apps/macos/Resources/Info.plist" CoveReleaseVersion)"
cove_marketing_version="$(plist_value "$cove_root/apps/macos/Resources/Info.plist" CFBundleShortVersionString)"
cove_minimum="$(plist_value "$cove_root/apps/macos/Resources/Info.plist" LSMinimumSystemVersion)"
test -n "$cove_version" || fail 'CoveReleaseVersion is empty'
test -n "$cove_marketing_version" || fail 'CFBundleShortVersionString is empty'
case "$cove_version" in
  "$cove_marketing_version"|"$cove_marketing_version"-alpha.*|"$cove_marketing_version"-beta.*|"$cove_marketing_version"-rc.*) ;;
  *) fail "CoveReleaseVersion $cove_version must use CFBundleShortVersionString $cove_marketing_version as its base" ;;
esac
cove_dmg="$cove_package_dir/Cove-$cove_version-arm64.dmg"
cove_dmg_checksum="$cove_dmg.sha256"

(
  cd "$cove_root"
  pnpm run build:web
)
MACOSX_DEPLOYMENT_TARGET="$cove_minimum" \
  "$cove_root/scripts/go" build -C "$cove_root/services/local-service" -o "$cove_app/Contents/Resources/cove-local-service" ./cmd/cove-local-service
(
  cove_author_kit="$cove_app/Contents/Resources/mini-apps"
  mkdir -p "$cove_author_kit/examples" "$cove_author_kit/scenarios"
  MACOSX_DEPLOYMENT_TARGET="$cove_minimum" "$cove_root/scripts/go" build -C "$cove_root/services/local-service" -o "$cove_app/Contents/MacOS/coveapp" ./cmd/coveapp
  cp "$cove_root/services/local-service/internal/appcatalog/packages/"*.coveapp "$cove_author_kit/examples/"
  cp "$cove_root/packages/api-contract/fixtures/mini-apps/"*.json "$cove_author_kit/scenarios/"
  cp "$cove_root/packages/api-contract/schemas/mini-app-v1.schema.json" "$cove_author_kit/"
  cp "$cove_root/services/local-service/cmd/coveapp/starter.coveapp" "$cove_author_kit/examples/"
  sed -e 's#](../services/local-service/internal/appcatalog/packages/#](examples/#g' \
      -e 's#](../services/local-service/cmd/coveapp/#](examples/#g' \
      -e 's#](../packages/api-contract/fixtures/mini-apps/#](scenarios/#g' \
      -e 's#](../packages/api-contract/schemas/#](#g' \
      -e 's#](development.md)#](https://github.com/tokenfunplus/cove/blob/main/docs/development.md)#g' \
      "$cove_root/docs/mini-apps.md" > "$cove_author_kit/authoring.md"
  cd "$cove_root/apps/macos"
  swift build -c release --product CoveLauncherApp
)
cove_swift_build="$(cd "$cove_root/apps/macos" && swift build -c release --show-bin-path)"

test -x "$cove_swift_build/CoveLauncherApp" || fail "Swift Launcher executable was not built"
cove_resource_bundle="$cove_swift_build/CoveLauncher_CoveLauncherApp.bundle"
test -d "$cove_resource_bundle" || fail "Swift Launcher resources were not built"
cp "$cove_swift_build/CoveLauncherApp" "$cove_app/Contents/MacOS/Cove"
cp -R "$cove_resource_bundle" "$cove_app/Contents/Resources/"
cp "$cove_root/apps/macos/Resources/Info.plist" "$cove_app/Contents/Info.plist"
cp "$cove_root/LICENSE" "$cove_app/Contents/Resources/LICENSE"
cp "$cove_root/THIRD_PARTY_NOTICES.md" "$cove_app/Contents/Resources/THIRD_PARTY_NOTICES.md"
node "$cove_root/scripts/prepare-inference-runtime.mjs"
mkdir -p "$cove_app/Contents/Resources/inference"
cp "$cove_root/.artifacts/inference/llama-server" "$cove_root/.artifacts/inference/LICENSE" "$cove_app/Contents/Resources/inference/"
cp -P "$cove_root/.artifacts/inference/"*.dylib "$cove_app/Contents/Resources/inference/"
node "$cove_root/scripts/prepare-speech-runtime.mjs"
mkdir -p "$cove_app/Contents/Resources/speech/kitten" "$cove_app/Contents/Resources/speech/source"
cp "$cove_root/.artifacts/speech/cove-speech-worker" "$cove_root/.artifacts/speech/pocket-tts" "$cove_root/.artifacts/speech/"*.dylib "$cove_root/.artifacts/speech/SPEECH_NOTICES.md" "$cove_root/.artifacts/speech/runtime-version.json" "$cove_app/Contents/Resources/speech/"
cp "$cove_root/.artifacts/speech/kitten/cove-speech-worker" "$cove_root/.artifacts/speech/kitten/"*.dylib "$cove_app/Contents/Resources/speech/kitten/"
cp -R "$cove_root/.artifacts/speech/source/." "$cove_app/Contents/Resources/speech/source/"
cp "$cove_root/.artifacts/speech/"*.txt "$cove_app/Contents/Resources/speech/"
node "$cove_root/scripts/collect-licenses.mjs" --include-go --output "$cove_app/Contents/Resources/THIRD_PARTY_LICENSES.txt"
if [ "$cove_insecure_file_secret_store" = "1" ]; then
  plutil -insert CoveInsecureFileSecretStore -bool true "$cove_app/Contents/Info.plist"
fi
create_app_icon

test -x "$cove_app/Contents/MacOS/Cove" || fail "Cove app executable is missing"
test -x "$cove_app/Contents/Resources/cove-local-service" || fail "Local Service executable is missing"
test -d "$cove_app/Contents/Resources/CoveLauncher_CoveLauncherApp.bundle" || fail "Cove app resource bundle is missing"
test -f "$cove_app/Contents/Info.plist" || fail "Cove app Info.plist is missing"
assert_arm64 "$cove_app/Contents/MacOS/coveapp"
assert_deployment_target "$cove_app/Contents/MacOS/coveapp"
assert_arm64 "$cove_app/Contents/MacOS/Cove"
assert_arm64 "$cove_app/Contents/Resources/cove-local-service"
assert_deployment_target "$cove_app/Contents/MacOS/Cove"
assert_deployment_target "$cove_app/Contents/Resources/cove-local-service"
assert_plist_value CFBundleIdentifier io.github.tokenfunplus.cove
assert_plist_value CFBundleExecutable Cove
assert_plist_value CFBundlePackageType APPL
assert_plist_value LSMinimumSystemVersion "$cove_minimum"
assert_plist_value CFBundleShortVersionString "$cove_marketing_version"
assert_plist_value CoveReleaseVersion "$cove_version"
assert_plist_value CFBundleIconFile AppIcon.icns
if [ "$cove_insecure_file_secret_store" = "1" ]; then
  assert_plist_value CoveInsecureFileSecretStore true
fi

cove_signing_identity="${COVE_SIGNING_IDENTITY:-}"
if [ "$cove_release" = "1" ]; then
  test -n "$cove_signing_identity" || fail 'COVE_SIGNING_IDENTITY is required for a distributable release build'
  test "${COVE_NOTARIZE:-0}" = "1" || fail 'COVE_NOTARIZE=1 is required for a distributable release build'
  test -n "${COVE_NOTARY_PROFILE:-}" || fail 'COVE_NOTARY_PROFILE is required for a distributable release build'
fi
if [ -n "$cove_signing_identity" ]; then
  require_command codesign
  find "$cove_app/Contents/Resources/inference" -type f ! -name LICENSE -exec codesign --force --options runtime --timestamp --sign "$cove_signing_identity" {} \;
  find "$cove_app/Contents/Resources/speech" -type f \( -name "*.dylib" -o -name cove-speech-worker -o -name pocket-tts \) -exec codesign --force --options runtime --timestamp --sign "$cove_signing_identity" {} \;
  codesign --force --options runtime --timestamp --sign "$cove_signing_identity" "$cove_app/Contents/Resources/cove-local-service"
  codesign --force --options runtime --timestamp --sign "$cove_signing_identity" "$cove_app/Contents/MacOS/coveapp"
  codesign --force --options runtime --timestamp --sign "$cove_signing_identity" "$cove_app"
  codesign --verify --deep --strict "$cove_app"
else
  require_command codesign
  find "$cove_app/Contents/Resources/inference" -type f ! -name LICENSE -exec codesign --force --sign - --timestamp=none {} \;
  find "$cove_app/Contents/Resources/speech" -type f \( -name "*.dylib" -o -name cove-speech-worker -o -name pocket-tts \) -exec codesign --force --sign - --timestamp=none {} \;
  codesign --force --sign - --timestamp=none \
    --identifier io.github.tokenfunplus.cove.local-service \
    "$cove_app/Contents/Resources/cove-local-service"
  codesign --force --sign - --timestamp=none "$cove_app/Contents/MacOS/coveapp"
  codesign --force --sign - --timestamp=none "$cove_app"
  codesign --verify --deep --strict "$cove_app"
  printf '%s\n' 'package-macos: no COVE_SIGNING_IDENTITY configured; built an ad-hoc signed package'
fi

case "${COVE_NOTARIZE:-0}" in
  0) ;;
  1)
    test -n "$cove_signing_identity" || fail 'COVE_SIGNING_IDENTITY is required when COVE_NOTARIZE=1'
    test -n "${COVE_NOTARY_PROFILE:-}" || fail 'COVE_NOTARY_PROFILE is required when COVE_NOTARIZE=1'
    require_command ditto
    require_command xcrun
    cove_archive="$cove_package_dir/Cove.zip"
    ditto -c -k --keepParent "$cove_app" "$cove_archive"
    xcrun notarytool submit "$cove_archive" --keychain-profile "$COVE_NOTARY_PROFILE" --wait
    xcrun stapler staple "$cove_app"
    xcrun stapler validate "$cove_app"
    require_command spctl
    spctl --assess --type execute --verbose "$cove_app"
    ;;
  *) fail 'COVE_NOTARIZE must be 0 or 1' ;;
esac

rm -f "$cove_dmg" "$cove_dmg_checksum"
"$cove_root/scripts/create-macos-dmg.sh" "$cove_app" "$cove_dmg"
(cd "$cove_package_dir" && shasum -a 256 "$(basename "$cove_dmg")" > "$(basename "$cove_dmg_checksum")")

printf '%s\n' "package-macos: created $cove_app"
printf '%s\n' "package-macos: created $cove_dmg"
printf '%s\n' "package-macos: created $cove_dmg_checksum"
