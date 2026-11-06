import AppKit
import SwiftUI
import CoveLauncher

@main
struct CoveLauncherApp: App {
    @StateObject private var launcher: LauncherStateMachine
    @State private var updateNotice: UpdateNotice?
    private let browser: BrowserOpening
    private let updateChecker: UpdateChecker

    init() {
        let service = BundledServiceManager(
            executableURL: bundledServiceURL(),
            insecureFileSecretStore: insecureFileSecretStoreEnabled()
        )
        let browser = launchBrowser()
        let stateMachine = LauncherStateMachine(service: service, browser: browser)
        service.onUnexpectedExit = { [weak stateMachine] in
            Task { @MainActor in
                stateMachine?.serviceExited()
            }
        }
        _launcher = StateObject(wrappedValue: stateMachine)
        Task { @MainActor in
            stateMachine.startIfNeededAndOpenChat()
        }
        self.browser = browser
        self.updateChecker = UpdateChecker(
            currentVersion: currentAppVersion(),
            manifestURL: updateManifestURL(),
            requester: URLSessionUpdateRequester()
        )
    }

    var body: some Scene {
        MenuBarExtra("Cove", systemImage: "bubble.left.and.bubble.right") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Cove")
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Divider()

                Button(localized("Open Chat")) {
                    launcher.openChat()
                }
                .disabled(!isReady)

                Button(localized("Restart Local Service")) {
                    try? launcher.restart()
                }

                Button(localized("Check for Updates")) {
                    checkForUpdates()
                }

                Divider()

                Button(localized("Quit Cove")) {
                    launcher.quit()
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(14)
            .frame(width: 240)
            .alert(item: $updateNotice) { notice in
                switch notice {
                case let .available(update):
                    return Alert(
                        title: Text(localized("Update Available")),
                        message: Text(String(format: localized("A new version %@ is available."), update.version)),
                        primaryButton: .default(Text(localized("Open Download Page"))) {
                            browser.open(update.downloadURL)
                        },
                        secondaryButton: .cancel(Text(localized("Later")))
                    )
                case .current:
                    return Alert(title: Text(localized("Cove is up to date.")))
                case .failed:
                    return Alert(title: Text(localized("Update check unavailable.")))
                }
            }
        }
        .menuBarExtraStyle(.window)
    }

    private var isReady: Bool {
        if case .ready = launcher.state {
            return true
        }
        return false
    }

    private var statusText: String {
        switch launcher.state {
        case .stopped:
            return localized("Local Service stopped")
        case .starting:
            return localized("Starting Local Service")
        case .ready:
            return localized("Local Service ready")
        case .failed:
            return localized("Local Service unavailable")
        }
    }

    private func checkForUpdates() {
        updateChecker.check { result in
            Task { @MainActor in
                switch result {
                case let .success(update):
                    updateNotice = update.map(UpdateNotice.available) ?? .current
                case .failure:
                    updateNotice = .failed
                }
            }
        }
    }
}

private enum UpdateNotice: Identifiable {
    case available(AppUpdate)
    case current
    case failed

    var id: String {
        switch self {
        case let .available(update):
            return "available-\(update.version)"
        case .current:
            return "current"
        case .failed:
            return "failed"
        }
    }
}

private final class WorkspaceBrowser: BrowserOpening {
    func open(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}

private final class PackageAcceptanceBrowser: BrowserOpening {
    func open(_ url: URL) {
        let output = "COVE_PACKAGE_ACCEPTANCE_BROWSER_URL=\(url.absoluteString)\n"
        FileHandle.standardOutput.write(Data(output.utf8))
    }
}

private func launchBrowser() -> BrowserOpening {
    if ProcessInfo.processInfo.environment["COVE_PACKAGE_ACCEPTANCE_TEST"] == "1" {
        return PackageAcceptanceBrowser()
    }
    return WorkspaceBrowser()
}

private func bundledServiceURL() -> URL {
    if let bundled = Bundle.main.url(forResource: "cove-local-service", withExtension: nil) {
        return bundled
    }
    if let override = ProcessInfo.processInfo.environment["COVE_LOCAL_SERVICE_PATH"] {
        return URL(fileURLWithPath: override)
    }
    return URL(fileURLWithPath: "cove-local-service", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
}

private func currentAppVersion() -> String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
}

private func insecureFileSecretStoreEnabled() -> Bool {
    Bundle.main.object(forInfoDictionaryKey: "CoveInsecureFileSecretStore") as? Bool == true
}

private func updateManifestURL() -> URL {
    let configured = Bundle.main.object(forInfoDictionaryKey: "CoveUpdateManifestURL") as? String
    return URL(string: configured ?? "https://github.com/tokenfunplus/cove/releases/latest/download/update.json")!
}

private func localized(_ key: String) -> String {
    String(localized: String.LocalizationValue(key), bundle: launcherResourceBundle)
}

private let launcherResourceBundle: Bundle = {
    guard let resourceURL = Bundle.main.resourceURL,
          let bundle = Bundle(url: resourceURL.appendingPathComponent("CoveLauncher_CoveLauncherApp.bundle"))
    else {
        return .main
    }
    return bundle
}()
