import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the menu-bar label renders packaged resources and a missing-resource fallback", {
  skip: process.platform !== "darwin",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-menu-bar-icon-"));
  try {
    const bundle = path.join(directory, "CoveLauncher_CoveLauncherApp.bundle");
    await cp(path.join(root, "apps/macos/Sources/CoveLauncherApp/Resources"), bundle, { recursive: true });
    // Match SwiftPM's installed resource bundle, which has no bundle identifier.
    await writeFile(path.join(bundle, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleDevelopmentRegion</key><string>en</string></dict></plist>
`);
    const emptyBundle = path.join(directory, "Empty.bundle");
    await mkdir(emptyBundle);
    await cp(path.join(bundle, "Info.plist"), path.join(emptyBundle, "Info.plist"));
    const main = path.join(directory, "main.swift");
    await writeFile(main, `import AppKit
import SwiftUI

MainActor.assumeIsolated {
    for (index, argument) in CommandLine.arguments.dropFirst().enumerated() {
        guard let bundle = Bundle(path: argument) else { fatalError("Missing test bundle") }
        let renderer = ImageRenderer(content: LauncherMenuBarIcon(bundle: bundle).foregroundStyle(.black))
        renderer.scale = 2
        guard let image = renderer.cgImage else { fatalError("The menu-bar icon did not render") }
        let bitmap = NSBitmapImageRep(cgImage: image)
        let hasVisiblePixels = (0..<bitmap.pixelsHigh).contains { y in
            (0..<bitmap.pixelsWide).contains { x in
                (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.1
            }
        }
        precondition(hasVisiblePixels, "The menu-bar icon is transparent")
        if index == 0 {
            precondition(image.width == 36 && image.height == 36, "The Cove mark must retain its 18-point size")
        }
    }
}
`);
    const executable = path.join(directory, "check-icon");
    const compilation = spawnSync("swiftc", [
      path.join(root, "apps/macos/Sources/CoveLauncherApp/LauncherMenuBarIcon.swift"), main,
      "-o", executable,
    ], { encoding: "utf8", timeout: 60_000 });
    assert.ifError(compilation.error);
    assert.equal(compilation.status, 0, compilation.stderr);
    const result = spawnSync(executable, [bundle, emptyBundle], { encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
