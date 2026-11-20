import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("launcher menu preserves release tags, one-time authorization, and private diagnostics", {
  skip: process.platform !== "darwin",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cove-launcher-menu-"));
  function run(command, args) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
  try {
    const library = path.join(root, "apps/macos/Sources/CoveLauncher");
    const sources = (await readdir(library)).filter(name => name.endsWith(".swift")).map(name => path.join(library, name));
    run("swiftc", ["-emit-library", "-static", "-emit-module", "-module-name", "CoveLauncher",
      "-emit-module-path", path.join(directory, "CoveLauncher.swiftmodule"),
      "-o", path.join(directory, "libCoveLauncher.a"), ...sources]);
    const main = path.join(directory, "main.swift");
    await writeFile(main, `import Foundation
import CoveLauncher

final class Service: ServiceManaging {
    var minted = 0
    var starts = 0
    var stops = 0
    var failStart = false
    let readiness = try! ServiceReadiness.parse(#"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#)
    func start() throws -> ServiceReadiness {
        starts += 1
        if failStart { throw LauncherError.serviceDidNotBecomeReady }
        return readiness
    }
    func mintBrowserLaunchToken() throws -> String { minted += 1; return "one-time-" + String(minted) }
    func stop() { stops += 1 }
}
final class Browser: BrowserOpening {
    var urls = [URL]()
    func open(_ url: URL) { urls.append(url) }
}

final class Process: ServiceProcess {
    var isRunning = true
    func terminate() { isRunning = false }
    func waitUntilExit() {}
    func stopReadingOutput() {}
}
struct ProcessLauncher: ServiceProcessLaunching {
    func launch(executableURL: URL, arguments: [String], onOutput: @escaping @Sendable (Data) -> Void,
                onTermination: @escaping @Sendable () -> Void) throws -> any ServiceProcess {
        onOutput(Data((#"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"# + "\\n").utf8))
        return Process()
    }
}
struct FileSystem: ServiceFileSystem {
    func isExecutableFile(at url: URL) -> Bool { true }
}
final class Control: ControlRequesting {
    var data = Data(#"{"provider_setup_required":true}"#.utf8)
    var paths = [String]()
    func post(url: URL, controlToken: String, completion: @escaping @Sendable (Data?, Int?) -> Void) {
        precondition(!controlToken.isEmpty)
        paths.append(url.path)
        completion(data, 200)
    }
}
final class StatusResult: @unchecked Sendable {
    var value: Result<LauncherServiceStatus, Error>?
}

MainActor.assumeIsolated {
    for version in ["0.1.0-beta.2", "1.0.0-rc.1", "1.0.0"] {
        let release = LauncherRelease(info: ["CoveReleaseVersion": version, "CFBundleShortVersionString": "0.1.0", "CFBundleVersion": "2"])
        precondition(release.version == version)
        precondition(release.releaseURL.absoluteString == "https://github.com/tokenfunplus/cove/releases/tag/v" + version)
    }
    let fallback = LauncherRelease(info: ["CFBundleShortVersionString": "1.2.3"])
    precondition(fallback.version == "1.2.3")
    let service = Service()
    let browser = Browser()
    let launcher = LauncherStateMachine(service: service, browser: browser)
    try! launcher.start()
    for destination in [ChatLaunchDestination.chat, .newChat, .settings, .providerSetup] {
        launcher.openChat(destination: destination)
        let url = URLComponents(url: browser.urls.last!, resolvingAgainstBaseURL: false)!
        precondition(url.scheme == "http" && url.host == "127.0.0.1" && url.port == 47123)
        precondition(url.path == "/launch")
        var expectedQuery = [URLQueryItem(name: "token", value: "one-time-" + String(service.minted))]
        if destination != .chat {
            expectedQuery.append(URLQueryItem(name: "intent", value: destination.rawValue))
        }
        precondition(url.queryItems == expectedQuery)
        precondition(url.fragment == nil)
    }
    precondition(service.minted == 4)

    let quietService = Service()
    let quietBrowser = Browser()
    let quietLauncher = LauncherStateMachine(service: quietService, browser: quietBrowser)
    quietLauncher.startAtLaunch(isLoginItem: true)
    quietLauncher.startAtLaunch(isLoginItem: true)
    precondition(quietService.starts == 1 && quietService.minted == 0 && quietBrowser.urls.isEmpty)
    quietLauncher.openChatOrRecover()
    precondition(quietService.starts == 1 && quietService.minted == 1 && quietBrowser.urls.count == 1)

    let failedService = Service()
    failedService.failStart = true
    let recoveredBrowser = Browser()
    let recoveredLauncher = LauncherStateMachine(service: failedService, browser: recoveredBrowser)
    recoveredLauncher.startAtLaunch(isLoginItem: false)
    guard case .failed = recoveredLauncher.state else { fatalError("Failed startup was not reported") }
    precondition(recoveredBrowser.urls.isEmpty)
    failedService.failStart = false
    recoveredLauncher.openChatOrRecover(destination: .providerSetup)
    precondition(failedService.starts == 2 && failedService.stops == 1 && failedService.minted == 1)
    precondition(URLComponents(url: recoveredBrowser.urls.last!, resolvingAgainstBaseURL: false)!.queryItems?.last == URLQueryItem(name: "intent", value: "provider-setup"))
    recoveredLauncher.serviceExited()
    recoveredLauncher.openChatOrRecover(destination: .newChat)
    precondition(failedService.starts == 3 && failedService.minted == 2)

    var availability = UpdateAvailability()
    let stable = AppUpdate(version: "1.1.0", downloadURL: URL(string: "https://example.test/stable")!)
    let beta = AppUpdate(version: "1.2.0-beta.2", downloadURL: URL(string: "https://example.test/beta")!)
    availability.record(beta, channel: .beta)
    availability.record(stable, channel: .stable)
    precondition(availability.update == beta)
    availability.record(nil, channel: .stable)
    precondition(availability.update == beta)
    availability.record(nil, channel: .beta)
    precondition(availability.update == nil)

    let control = Control()
    let manager = BundledServiceManager(executableURL: URL(fileURLWithPath: "/fixture/service"),
        processLauncher: ProcessLauncher(), controlRequester: control, fileSystem: FileSystem())
    try! manager.start()
    let status = StatusResult()
    manager.fetchStatus { status.value = $0 }
    guard case let .success(value) = status.value else { fatalError("Missing setup status") }
    precondition(value.providerSetupRequired)
    precondition(control.paths == ["/internal/control/status"])
    control.data = Data(#"{}"#.utf8)
    manager.fetchStatus { status.value = $0 }
    guard case .failure = status.value else { fatalError("Missing setup status must stay unknown") }
    manager.stop()
    let release = LauncherRelease(info: ["CoveReleaseVersion": "0.1.0-beta.2"])
    for state in [LauncherState.ready(service.readiness), .failed("synthetic-private-error")] {
        let report = launcherDiagnosticReport(release: release, state: state, launchAtLogin: false, shortcutEnabled: false)
        precondition(!report.contains(service.readiness.launchToken))
        precondition(!report.contains("synthetic-private-error"))
        precondition(!report.contains("127.0.0.1"))
        precondition(report.contains("Cove: 0.1.0-beta.2"))
    }
}
`);
    const appSources = path.join(root, "apps/macos/Sources/CoveLauncherApp");
    const executable = path.join(directory, "check-menu");
    run("swiftc", ["-I", directory, "-L", directory, "-lCoveLauncher",
      path.join(appSources, "LauncherRelease.swift"), path.join(appSources, "LauncherDiagnostics.swift"), main, "-o", executable]);
    run(executable, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
