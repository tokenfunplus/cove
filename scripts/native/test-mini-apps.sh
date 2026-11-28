#!/bin/sh
set -eu
if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/native/test-mini-apps.sh LOCAL_SERVICE [--os-handoff] [--interactive] [--managed] [--compatible] [--cloud]" >&2
  exit 2
fi
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
swiftc -swift-version 5 -module-name CoveLauncher -emit-library -enable-testing -emit-module \
  -emit-module-path "$build/CoveLauncher.swiftmodule" -o "$build/libCoveLauncher.dylib" \
  "$root"/apps/macos/Sources/CoveLauncher/*.swift
swiftc -swift-version 5 -parse-as-library -I "$build" -L "$build" -lCoveLauncher -Xlinker -rpath -Xlinker "$build" \
  -o "$build/acceptance" "$root/apps/macos/Sources/CoveLauncherApp/MiniAppFilePicker.swift" \
  "$root/scripts/native/mini-app-system-handoff.swift" "$root/scripts/native/mini-app-model-acceptance.swift" "$root/scripts/native/mini-app-launcher-acceptance.swift"
"$build/acceptance" "$@"
