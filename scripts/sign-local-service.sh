#!/bin/sh
set -eu

fail() {
  printf 'sign-local-service: %s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail 'Expected the Local Service executable path'
cove_binary="$1"
[ -x "$cove_binary" ] || fail 'The Local Service executable does not exist or is not executable'

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

cove_identity="${COVE_SIGNING_IDENTITY:-}"
if [ -z "$cove_identity" ]; then
  cove_identities="$(security find-identity -v -p codesigning)" || fail 'Could not list code-signing identities'
  cove_candidates="$(printf '%s\n' "$cove_identities" | awk '/"Developer ID Application:/ && length($2) == 40 && $2 ~ /^[[:xdigit:]]+$/ { print $2 }')"
  if [ -z "$cove_candidates" ]; then
    cove_candidates="$(printf '%s\n' "$cove_identities" | awk '/"Apple Development:/ && length($2) == 40 && $2 ~ /^[[:xdigit:]]+$/ { print $2 }')"
  fi
  cove_count="$(printf '%s\n' "$cove_candidates" | awk 'NF { count++ } END { print count+0 }')"
  case "$cove_count" in
    0) cove_identity='-' ;;
    1) cove_identity="$cove_candidates" ;;
    *) fail 'Multiple code-signing identities are available; set COVE_SIGNING_IDENTITY to the intended certificate name or fingerprint' ;;
  esac
fi

# Local builds stay offline. Distributable packages add a secure timestamp and
# notarization through package-macos.sh.
codesign --force --options runtime --timestamp=none \
  --identifier io.github.tokenfunplus.cove.local-service \
  --sign "$cove_identity" "$cove_binary"
codesign --verify --strict "$cove_binary"

if [ "$cove_identity" = '-' ]; then
  printf '%s\n' 'Local Service uses an ad-hoc signature; set COVE_SIGNING_IDENTITY for stable Keychain authorization.'
else
  printf '%s\n' 'Local Service signed and verified with a certificate-backed identity.'
fi
