#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/native/test-mini-app-compatible.sh LOCAL_SERVICE" >&2
  exit 2
fi
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
fixture=$(mktemp -d)
fixture_pid=''
cleanup() {
  if [ -n "$fixture_pid" ]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT
node "$root/scripts/native/mini-app-compatible-fixture.mjs" "$fixture/endpoint" &
fixture_pid=$!
tries=0
while [ ! -s "$fixture/endpoint" ]; do
  kill -0 "$fixture_pid"
  tries=$((tries + 1))
  [ "$tries" -lt 50 ]
  sleep 0.1
done
COVE_ACCEPTANCE_LOOPBACK_ENDPOINT=$(cat "$fixture/endpoint") COVE_ACCEPTANCE_LOOPBACK_MODEL=native-fixture "$root/scripts/native/test-mini-apps.sh" "$1" --compatible
