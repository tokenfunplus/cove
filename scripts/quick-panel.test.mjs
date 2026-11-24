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

final class FocusTestWindow: NSPanel {
    override var canBecomeKey: Bool { true }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    var restorations = 0
    var mayCaptureFocus = true
    var coveActive = true
    let controller = QuickPanelController(launchURL: { nil }, openChat: { _ in false },
        openProviderSettings: { false }, reauthorize: { _ in nil }, captureFocusReturn: { () -> (@MainActor () -> Void)? in
            if !mayCaptureFocus { return nil }
            return { restorations += 1 }
        }, isApplicationActive: { coveActive })
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
    mayCaptureFocus = false
    panel.setFrameOrigin(NSPoint(x: 1_000_000, y: -1_000_000))
    controller.show()
    let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main!
    precondition(screen.visibleFrame.intersects(panel.frame), "Reopening must recover a lost display position")
    panel.delegate?.windowDidResignKey?(Notification(name: NSWindow.didResignKeyNotification, object: panel))
    precondition(panel.level == .normal, "An unpinned panel must stop floating when focus leaves")
    panel.delegate?.windowDidBecomeKey?(Notification(name: NSWindow.didBecomeKeyNotification, object: panel))
    precondition(panel.level == .floating, "Refocusing must bring the panel forward again")
    precondition(!controller.windowShouldClose(panel) && !panel.isVisible, "Close must hide the panel")
    precondition(restorations == 1, "Hiding must restore the original app after repeated invocations")
    mayCaptureFocus = true
    controller.show()
    precondition(panel.isVisible && panel.contentView === content, "Reopening must retain the mounted draft surface")
    let other = FocusTestWindow(contentRect: NSRect(x: 0, y: 0, width: 120, height: 80), styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
    other.orderFrontRegardless()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    _ = controller.windowShouldClose(panel)
    precondition(restorations == 1 && other.isKeyWindow, "Another Cove window must keep focus: restores=\\(restorations) key=\\(other.isKeyWindow) visible=\\(other.isVisible) keyable=\\(other.canBecomeKey) ordered=\\(app.orderedWindows.count)")
    other.orderOut(nil)
    controller.show()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    coveActive = false
    _ = controller.windowShouldClose(panel)
    precondition(restorations == 1, "Hiding must not steal focus back from a newly active app")
}
`);
    const executable = path.join(directory, "check-panel");
    run("swiftc", ["-target", "arm64-apple-macosx13.0", path.join(root, "apps/macos/Sources/CoveLauncherApp/QuickPanelController.swift"), main, "-o", executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
