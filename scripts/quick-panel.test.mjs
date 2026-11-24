import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("Quick Panel presents above other apps and recovers an offscreen window", {
  skip: process.platform !== "darwin" || process.arch !== "arm64" || process.env.COVE_TEST_QUICK_PANEL !== "1",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-panel-test-"));
  function run(command, args) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000,
      env: { ...process.env, COVE_DATA_DIR: path.join(directory, "data") } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
  try {
    const main = path.join(directory, "main.swift");
    await writeFile(main, `import AppKit
import WebKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    let controller = QuickPanelController(launchURL: { nil }, openChat: { _ in false },
        openProviderSettings: { false }, reauthorize: { _ in nil })
    controller.prepare()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    let panel = app.windows.first { $0.title == "Cove Quick Panel" }!
    precondition(!panel.isVisible, "Preparing the panel must stay in the background")
    let content = panel.contentView
    controller.show()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    precondition(panel.isVisible, "An explicit invocation must show the panel")
    precondition(panel.isKeyWindow, "The invoked panel must accept keyboard input")
    precondition(panel.level == .floating, "The invoked panel must appear above other apps")
    precondition(panel.collectionBehavior.contains(.canJoinAllApplications), "The panel must join full screen and Stage Manager apps")
    panel.setFrameOrigin(NSPoint(x: 1_000_000, y: -1_000_000))
    controller.show()
    let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main!
    precondition(screen.visibleFrame.intersects(panel.frame), "Reopening must recover a lost display position")
    panel.delegate?.windowDidResignKey?(Notification(name: NSWindow.didResignKeyNotification, object: panel))
    precondition(panel.level == .normal, "An unpinned panel must stop floating when focus leaves")
    panel.delegate?.windowDidBecomeKey?(Notification(name: NSWindow.didBecomeKeyNotification, object: panel))
    precondition(panel.level == .floating, "Refocusing must bring the panel forward again")
    precondition(!controller.windowShouldClose(panel) && !panel.isVisible, "Close must hide the panel")
    controller.show()
    precondition(panel.isVisible && panel.contentView === content, "Reopening must retain the mounted draft surface")
    _ = controller.windowShouldClose(panel)
}
`);
    const executable = path.join(directory, "check-panel");
    run("swiftc", ["-target", "arm64-apple-macosx13.0", path.join(root, "apps/macos/Sources/CoveLauncherApp/QuickPanelController.swift"), main, "-o", executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
