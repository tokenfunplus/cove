#!/bin/sh
set -eu
umask 077

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fail() {
  printf 'notarize-macos-package: %s\n' "$1" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || fail 'Usage: notarize-macos-package.sh SOURCE_APP [OUTPUT_DIRECTORY]'
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail 'An Apple Silicon Mac is required'
cove_identity="${COVE_SIGNING_IDENTITY:-}"
cove_profile="${COVE_NOTARY_PROFILE:-}"
[ -n "$cove_identity" ] && [ "$cove_identity" != '-' ] || fail 'COVE_SIGNING_IDENTITY must select a Developer ID Application certificate'
[ -n "$cove_profile" ] || fail 'COVE_NOTARY_PROFILE is required'
cove_source="$1"
cove_info="$cove_source/Contents/Info.plist"
[ -f "$cove_info" ] || fail 'The source app has no Info.plist'

plist_value() {
  plutil -extract "$2" raw -o - "$1"
}

cove_version="$(plist_value "$cove_root/apps/macos/Resources/Info.plist" CoveReleaseVersion)"
for cove_key in CFBundleIdentifier CoveReleaseVersion CFBundleShortVersionString CFBundleVersion LSMinimumSystemVersion; do
  cove_expected="$(plist_value "$cove_root/apps/macos/Resources/Info.plist" "$cove_key")"
  cove_actual="$(plist_value "$cove_info" "$cove_key")"
  [ "$cove_actual" = "$cove_expected" ] || fail "The source app's $cove_key does not match this checkout"
done
if plutil -extract CoveInsecureFileSecretStore raw -o - "$cove_info" >/dev/null 2>&1; then
  fail 'A test app with file-based Provider secrets cannot be published'
fi
cove_sensitive="$(find "$cove_source" -type f \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' -o -name '*.p12' -o -name '*.p8' -o -name '*.keychain-db' -o -name '.env' -o -name 'insecure-test-provider-secrets.json' \) -print)"
[ -z "$cove_sensitive" ] || fail 'The source app contains local state or credential files'
cove_minimum="$(plist_value "$cove_info" LSMinimumSystemVersion)"
for cove_executable in Contents/MacOS/Cove Contents/Resources/cove-local-service; do
  [ -x "$cove_source/$cove_executable" ] || fail "Missing executable: $cove_executable"
  case "$(file -b "$cove_source/$cove_executable")" in
    *arm64*) ;;
    *) fail "The source executable is not arm64: $cove_executable" ;;
  esac
  cove_binary_minimum="$(otool -l "$cove_source/$cove_executable" | awk '
    /LC_BUILD_VERSION/ { kind=1 }
    /LC_VERSION_MIN_MACOSX/ { kind=2 }
    kind==1 && $1=="minos" { print $2; exit }
    kind==2 && $1=="version" { print $2; exit }
  ')"
  [ -n "$cove_binary_minimum" ] || fail "Cannot read deployment target: $cove_executable"
  awk -v actual="$cove_binary_minimum" -v expected="$cove_minimum" 'BEGIN {
    split(actual, a, "[.]"); split(expected, e, "[.]");
    for (i=1; i<=3; i++) if (a[i]+0 != e[i]+0) exit (a[i]+0 > e[i]+0);
    exit 0;
  }' || fail "$cove_executable requires macOS $cove_binary_minimum instead of the advertised $cove_minimum"
done
[ -f "$cove_source/Contents/Resources/THIRD_PARTY_LICENSES.txt" ] || fail 'Third-party license notices are missing'

cove_output="${2:-$cove_root/.artifacts/notarized}"
mkdir -p "$cove_output"
cove_output="$(CDPATH= cd -- "$cove_output" && pwd)"
cove_stage="$(mktemp -d "${TMPDIR:-/tmp}/cove-notarize.XXXXXX")"
trap 'rm -rf "$cove_stage"' EXIT INT TERM
cove_app="$cove_stage/Cove.app"
cove_dmg="$cove_output/Cove-$cove_version-arm64.dmg"
ditto "$cove_source" "$cove_app"

if [ -d "$cove_app/Contents/Resources/inference" ]; then
  find "$cove_app/Contents/Resources/inference" -type f ! -name LICENSE -exec codesign --force --options runtime --timestamp --sign "$cove_identity" {} +
fi
if [ -d "$cove_app/Contents/Resources/speech" ]; then
  find "$cove_app/Contents/Resources/speech" -type f \( -name '*.dylib' -o -name cove-speech-worker -o -name pocket-tts \) -exec codesign --force --options runtime --timestamp --sign "$cove_identity" {} +
fi
codesign --force --options runtime --timestamp \
  --identifier io.github.tokenfunplus.cove.local-service \
  --sign "$cove_identity" "$cove_app/Contents/Resources/cove-local-service"
codesign --force --options runtime --timestamp --sign "$cove_identity" "$cove_app"
codesign --verify --deep --strict "$cove_app"

notarize() {
  cove_submission="$1"
  cove_result="$2"
  xcrun notarytool submit "$cove_submission" --keychain-profile "$cove_profile" --wait --output-format json > "$cove_result"
  cove_status="$(plutil -extract status raw -o - "$cove_result")"
  [ "$cove_status" = Accepted ] || fail "Notarization was not accepted; inspect $cove_result"
}

ditto -c -k --keepParent "$cove_app" "$cove_stage/Cove.zip"
notarize "$cove_stage/Cove.zip" "$cove_output/app-notarization.json"
xcrun stapler staple "$cove_app"
xcrun stapler validate "$cove_app"
spctl --assess --type execute --verbose "$cove_app"

"$cove_root/scripts/create-macos-dmg.sh" "$cove_app" "$cove_dmg"
codesign --force --timestamp --sign "$cove_identity" "$cove_dmg"
notarize "$cove_dmg" "$cove_output/dmg-notarization.json"
xcrun stapler staple "$cove_dmg"
xcrun stapler validate "$cove_dmg"
codesign --verify --strict "$cove_dmg"
spctl --assess --type open --context context:primary-signature --verbose "$cove_dmg"
(cd "$cove_output" && shasum -a 256 "$(basename "$cove_dmg")" > "$(basename "$cove_dmg").sha256")
node "$cove_root/scripts/write-update-manifest.mjs" "$cove_version" \
  "https://github.com/tokenfunplus/cove/releases/download/v$cove_version/$(basename "$cove_dmg")" \
  "$cove_output/update.json"
printf 'Notarized app and disk image verified: %s\n' "$cove_dmg"
