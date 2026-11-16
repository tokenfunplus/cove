import AppKit
import SwiftUI
import CoveLauncher
import ServiceManagement

@main
struct CoveLauncherApp: App {
    @StateObject private var launcher: LauncherStateMachine
    @StateObject private var desktop: LauncherDesktopActions

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
        _desktop = StateObject(wrappedValue: LauncherDesktopActions(
            launcher: stateMachine, browser: browser, resources: launcherResourceBundle
        ))
        Task { @MainActor in
            stateMachine.startIfNeededAndOpenChat()
        }
    }

    var body: some Scene {
        MenuBarExtra {
            Group {
                Text("Cove").font(.headline)
                Text(statusText)

                Divider()

                Button {
                    launcher.openChat()
                } label: {
                    Label(localized("Open Chat"), systemImage: "bubble.left.and.bubble.right")
                }
                .keyboardShortcut("o")
                .disabled(!isReady)

                Button {
                    launcher.openChat(destination: .newChat)
                } label: {
                    Label(localized("New Chat"), systemImage: "square.and.pencil")
                }
                .keyboardShortcut("n")
                .disabled(!isReady)

                Button {
                    launcher.openChat(destination: .settings)
                } label: {
                    Label(localized("Settings…"), systemImage: "gearshape")
                }
                .keyboardShortcut(",")
                .disabled(!isReady)

                Divider()

                Toggle(localized("Launch at Login"), isOn: Binding(
                    get: { desktop.launchAtLogin },
                    set: { desktop.setLaunchAtLogin($0) }
                ))
                if desktop.loginStatus == .requiresApproval {
                    Button(localized("Allow Launch at Login…")) {
                        SMAppService.openSystemSettingsLoginItems()
                    }
                }
                Toggle(localized("Global Shortcut: ⌃⌥Space"), isOn: Binding(
                    get: { desktop.shortcutEnabled },
                    set: { desktop.setShortcutEnabled($0) }
                ))

                Menu(localized("Troubleshooting")) {
                    Button(localized("Restart Local Service")) { desktop.restart() }
                    Button(localized("Copy Diagnostics")) { desktop.copyDiagnostics() }
                    Button(localized("Open Data Folder")) { desktop.openDataFolder() }
                }

                Divider()

                Button(localized("About Cove")) { desktop.showAbout() }
                Button("Version \(desktop.release.version)") { desktop.openReleaseNotes() }
                Button(localized(desktop.checkingForUpdates ? "Checking for Updates…" : "Check for Updates…")) {
                    desktop.checkForUpdates()
                }
                .disabled(desktop.checkingForUpdates)
                Menu(localized("Help & Feedback")) {
                    Button(localized("User Guide")) { desktop.openUserGuide() }
                    Button(localized("Report an Issue…")) { desktop.openIssueTracker() }
                }

                Divider()

                Button(localized("Quit Cove")) {
                    launcher.quit()
                    NSApplication.shared.terminate(nil)
                }
                .keyboardShortcut("q")
            }
            .onAppear { desktop.refreshLoginStatus() }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                desktop.refreshLoginStatus()
            }
        } label: {
            LauncherMenuBarIcon(bundle: launcherResourceBundle)
                .accessibilityLabel("Cove")
        }
        .menuBarExtraStyle(.menu)
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

private func insecureFileSecretStoreEnabled() -> Bool {
    Bundle.main.object(forInfoDictionaryKey: "CoveInsecureFileSecretStore") as? Bool == true
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
