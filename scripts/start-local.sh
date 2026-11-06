#!/bin/sh
set -eu

cove_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cove_artifacts="$cove_root/.artifacts"
cove_binary="$cove_artifacts/cove-local-service"
cove_log="$cove_artifacts/cove-local-service.log"
cove_state="$cove_artifacts/cove-local-service.state"
cove_insecure_file_secret_store="${COVE_INSECURE_FILE_SECRET_STORE:-0}"

case "$cove_insecure_file_secret_store" in
  0|1) ;;
  *) printf '%s\n' 'COVE_INSECURE_FILE_SECRET_STORE must be 0 or 1' >&2; exit 1 ;;
esac

umask 077
mkdir -p "$cove_artifacts"

if [ -f "$cove_state" ]; then
  cove_pid="$(sed -n 's/^pid=//p' "$cove_state")"
  cove_url="$(sed -n 's/^url=//p' "$cove_state")"
  cove_control_token="$(sed -n 's/^control_token=//p' "$cove_state")"
  cove_running_insecure_file_secret_store="$(sed -n 's/^insecure_file_secret_store=//p' "$cove_state")"
  cove_running_insecure_file_secret_store="${cove_running_insecure_file_secret_store:-0}"
  if [ -n "$cove_pid" ] && kill -0 "$cove_pid" 2>/dev/null \
    && [ "$cove_running_insecure_file_secret_store" != "$cove_insecure_file_secret_store" ]; then
    printf '%s\n' 'The Local Service is using a different Secret Store mode; run make stop-local first' >&2
    exit 1
  fi
  if [ -n "$cove_pid" ] && [ -n "$cove_url" ] && [ -n "$cove_control_token" ] \
    && [ "$cove_running_insecure_file_secret_store" = "$cove_insecure_file_secret_store" ] \
    && kill -0 "$cove_pid" 2>/dev/null; then
    if cove_browser_token="$(curl -fsS --connect-timeout 1 -X POST \
      -H "X-Cove-Control-Token: $cove_control_token" \
      "$cove_url/internal/control/launch-token" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.parse(input).launch_token || ""); }
  catch { process.exitCode = 1; }
});' 2>/dev/null)" && [ -n "$cove_browser_token" ]; then
      open "$cove_url/launch?token=$cove_browser_token"
      printf 'Reusing the running Cove Local Service: %s\n' "$cove_url"
      exit 0
    fi
  fi
  rm -f "$cove_state"
fi

printf 'Building Cove Web and Local Service...\n'
(cd "$cove_root" && make build-service)

cove_control_token="${COVE_LOCAL_CONTROL_TOKEN:-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')}"
printf 'Starting Local Service...\n'
set -- --control-token "$cove_control_token"
if [ "$cove_insecure_file_secret_store" = "1" ]; then
  set -- --insecure-file-secret-store "$@"
fi
"$cove_binary" "$@" > "$cove_log" 2>&1 &
cove_pid=$!
trap 'kill "$cove_pid" 2>/dev/null || true; rm -f "$cove_state"' EXIT INT TERM

cove_url=""
cove_attempt=0
while [ "$cove_attempt" -lt 100 ]; do
  if ! kill -0 "$cove_pid" 2>/dev/null; then
    printf 'Local Service failed to start. Recent log output:\n' >&2
    tail -n 30 "$cove_log" >&2 || true
    exit 1
  fi
  cove_url="$(node -e '
const fs = require("fs");
try {
  for (const line of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
    try {
      const payload = JSON.parse(line);
      if (payload.url && payload.launch_token) { process.stdout.write(payload.url); break; }
    } catch {}
  }
} catch {}' "$cove_log" 2>/dev/null || true)"
  if [ -n "$cove_url" ]; then break; fi
  cove_attempt=$((cove_attempt + 1))
  sleep 0.1
done

if [ -z "$cove_url" ]; then
  printf 'Local Service was not ready within 10 seconds. Recent log output:\n' >&2
  tail -n 30 "$cove_log" >&2 || true
  exit 1
fi

printf 'pid=%s\nurl=%s\ncontrol_token=%s\ninsecure_file_secret_store=%s\n' "$cove_pid" "$cove_url" "$cove_control_token" "$cove_insecure_file_secret_store" > "$cove_state"
trap - EXIT INT TERM

cove_browser_token=""
cove_attempt=0
while [ "$cove_attempt" -lt 50 ]; do
  if cove_browser_token="$(curl -fsS --connect-timeout 1 -X POST \
    -H "X-Cove-Control-Token: $cove_control_token" \
    "$cove_url/internal/control/launch-token" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.parse(input).launch_token || ""); }
  catch { process.exitCode = 1; }
});' 2>/dev/null)" && [ -n "$cove_browser_token" ]; then break; fi
  cove_attempt=$((cove_attempt + 1))
  sleep 0.1
done

if [ -z "$cove_browser_token" ]; then
  printf 'Local Service started but could not issue a Browser Session token. Log: %s\n' "$cove_log" >&2
  exit 1
fi

open "$cove_url/launch?token=$cove_browser_token"
printf 'Opened Cove Chat at %s\n' "$cove_url"
