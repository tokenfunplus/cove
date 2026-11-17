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
    let readiness = try! ServiceReadiness.parse(#"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#)
    func start() throws -> ServiceReadiness { readiness }
    func mintBrowserLaunchToken() throws -> String { minted += 1; return "one-time-" + String(minted) }
    func stop() {}
}
final class Browser: BrowserOpening {
    var urls = [URL]()
    func open(_ url: URL) { urls.append(url) }
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
    for destination in [ChatLaunchDestination.chat, .newChat, .settings] {
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
    precondition(service.minted == 3)
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
