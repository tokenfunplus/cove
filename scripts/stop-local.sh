#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cove_state="$cove_root/.artifacts/cove-local-service.state"

if [ ! -f "$cove_state" ]; then
  printf 'Cove Local Service is not running\n'
  exit 0
fi

cove_pid="$(sed -n 's/^pid=//p' "$cove_state")"
cove_url="$(sed -n 's/^url=//p' "$cove_state")"
cove_control_token="$(sed -n 's/^control_token=//p' "$cove_state")"

if [ -z "$cove_pid" ] || [ -z "$cove_url" ] || [ -z "$cove_control_token" ]; then
  printf 'Invalid Local Service state file: %s\n' "$cove_state" >&2
  exit 1
fi

if ! kill -0 "$cove_pid" 2>/dev/null; then
  rm -f "$cove_state"
  printf 'Cleared stale Cove Local Service state\n'
  exit 0
fi

if ! curl -fsS --connect-timeout 1 -X POST \
  -H "X-Cove-Control-Token: $cove_control_token" \
  "$cove_url/internal/control/shutdown" >/dev/null; then
  printf 'Could not stop Local Service through its control endpoint. State retained to avoid stopping an unrelated process: %s\n' "$cove_state" >&2
  exit 1
fi

cove_attempt=0
while kill -0 "$cove_pid" 2>/dev/null && [ "$cove_attempt" -lt 50 ]; do
  cove_attempt=$((cove_attempt + 1))
  sleep 0.1
done

if kill -0 "$cove_pid" 2>/dev/null; then
  kill "$cove_pid" 2>/dev/null || true
fi

rm -f "$cove_state"
printf 'Cove Local Service stopped\n'
