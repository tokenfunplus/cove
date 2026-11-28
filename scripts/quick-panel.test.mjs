import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSources = path.join(root, "apps/macos/Sources/CoveLauncherApp");
const controllerSources = ["QuickPanelController.swift", "DesktopImport.swift"].map(file => path.join(appSources, file));
const skipNative = process.platform !== "darwin" || process.arch !== "arm64" || process.env.COVE_TEST_QUICK_PANEL !== "1";

async function launcherLinkArguments(directory) {
  const source = path.join(root, "apps/macos/Sources/CoveLauncher");
  const files = (await readdir(source)).filter(file => file.endsWith(".swift")).map(file => path.join(source, file));
  const result = spawnSync("swiftc", ["-target", "arm64-apple-macosx13.0", "-emit-library", "-static", "-emit-module",
    "-module-name", "CoveLauncher", "-emit-module-path", path.join(directory, "CoveLauncher.swiftmodule"),
    "-o", path.join(directory, "libCoveLauncher.a"), ...files], { encoding: "utf8", timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return ["-I", directory, "-L", directory, "-lCoveLauncher"];
}

test("Quick Panel presents above other apps and recovers an offscreen window", {
  skip: skipNative,
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
    let selection = "Selected \\u{4F60} text\\nSecond line"
    let pending = try! DesktopImport(text: selection)
    precondition(pending.bridgeValue["text"] == selection, "The bridge must preserve the selection verbatim")
    try! controller.stageImport(pending)
    try! controller.stageImport(pending)
    for _ in 1..<4 {
        try! controller.stageImport(DesktopImport(text: "Another selection"))
    }
    do {
        try controller.stageImport(DesktopImport(text: "One more selection"))
        preconditionFailure("The import queue must stay bounded")
    } catch DesktopIntakeError.queueFull {
    } catch {
        preconditionFailure("Expected an import queue error")
    }
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
    run("swiftc", ["-target", "arm64-apple-macosx13.0", ...await launcherLinkArguments(directory), ...controllerSources, main, "-o", executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Quick Panel replays only pending selections after its WebKit page reloads", { skip: skipNative }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-panel-reload-"));
  const deliveries = [];
  let page = 0;
  const server = createServer((request, response) => {
    if (request.url === "/launch") {
      response.writeHead(303, { Location: "/?surface=quick-panel" }).end();
    } else if (request.url === "/?surface=quick-panel") {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end(`<!doctype html><script>
        const page = ${++page};
        const bridge = webkit.messageHandlers.coveQuickPanel;
        window.addEventListener('cove-quick-panel-import', async (event) => {
          event.preventDefault();
          const { id, text } = event.detail;
          if (text === 'Applied selection') bridge.postMessage({ action: 'import-consumed', id });
          await fetch('/delivery', { method: 'POST', body: JSON.stringify({ page, text }) });
          if (page === 1 && text === 'Pending selection') location.reload();
        });
        window.addEventListener('load', () => bridge.postMessage({ action: 'ready' }));
      </script>`);
    } else if (request.method === "POST" && request.url === "/delivery") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        deliveries.push(JSON.parse(body));
        response.writeHead(204).end();
      });
    } else {
      response.writeHead(404).end();
    }
  });
  try {
    const main = path.join(directory, "main.swift");
    const executable = path.join(directory, "reload-panel");
    await writeFile(main, `import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    let controller = QuickPanelController(launchURL: { URL(string: CommandLine.arguments[1]) },
        openChat: { _ in false }, openProviderSettings: { false }, reauthorize: { _ in nil })
    try! controller.stageImport(DesktopImport(text: "Applied selection"))
    try! controller.stageImport(DesktopImport(text: "Pending selection"))
    controller.show()
    RunLoop.main.run(until: Date().addingTimeInterval(7))
    withExtendedLifetime(controller) {}
}
`);
    const build = spawnSync("swiftc", ["-target", "arm64-apple-macosx13.0", ...await launcherLinkArguments(directory), ...controllerSources, main, "-o", executable], {
      encoding: "utf8", timeout: 60_000,
    });
    assert.ifError(build.error);
    assert.equal(build.status, 0, build.stderr);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const launch = `http://127.0.0.1:${server.address().port}/launch`;
    const child = spawn(executable, [launch], {
      env: { ...process.env, COVE_DATA_DIR: path.join(directory, "data") },
      stdio: ["ignore", "ignore", "pipe"], timeout: 15_000,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [status] = await once(child, "close");
    assert.equal(status, 0, stderr);
    assert.equal(page, 2);
    assert.deepEqual(deliveries.filter(item => item.page === 1).map(item => item.text).sort(), ["Applied selection", "Pending selection"]);
    assert.deepEqual(deliveries.filter(item => item.page === 2).map(item => item.text), ["Pending selection"]);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
