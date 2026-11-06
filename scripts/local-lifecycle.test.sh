#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cove_state="$cove_root/.artifacts/cove-local-service.state"
cove_open_dir="$(mktemp -d "${TMPDIR:-/tmp}/cove-local-test.XXXXXX")"
cove_started_service=0
export COVE_DATA_DIR="$cove_open_dir/data"
export COVE_INSECURE_FILE_SECRET_STORE=1

cleanup() {
  if [ "$cove_started_service" -eq 1 ] && [ -x "$cove_root/scripts/stop-local.sh" ]; then
    "$cove_root/scripts/stop-local.sh" >/dev/null 2>&1 || true
  fi
  rm -rf "$cove_open_dir"
}
trap cleanup EXIT INT TERM

if [ ! -x "$cove_root/scripts/stop-local.sh" ]; then
  printf '%s\n' 'stop-local.sh must be an executable lifecycle command' >&2
  exit 1
fi

if [ -f "$cove_state" ]; then
  printf '%s\n' 'stop-local.sh must be run before the lifecycle test when Local Service is already running' >&2
  exit 1
fi

PATH="$cove_open_dir:$PATH"
cat > "$cove_open_dir/open" <<'SH'
#!/bin/sh
exit 0
SH
chmod +x "$cove_open_dir/open"

cove_started_service=1
"$cove_root/scripts/start-local.sh" >/dev/null

test -f "$cove_state"
cove_url="$(sed -n 's/^url=//p' "$cove_state")"
curl -fsS "$cove_url/api/health" >/dev/null

"$cove_root/scripts/start-local.sh" >/dev/null
curl -fsS "$cove_url/api/health" >/dev/null

"$cove_root/scripts/stop-local.sh" >/dev/null
test ! -f "$cove_state"
