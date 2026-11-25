import AppKit
import SwiftUI
import CoveLauncher
import ServiceManagement

@main
struct CoveLauncherApp: App {
    @StateObject private var launcher: LauncherStateMachine
    @StateObject private var desktop: LauncherDesktopActions
    @NSApplicationDelegateAdaptor(LauncherApplicationDelegate.self) private var applicationDelegate

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
        let desktopActions = LauncherDesktopActions(
            launcher: stateMachine, browser: browser, resources: launcherResourceBundle, serviceStatus: service
        )
        _desktop = StateObject(wrappedValue: desktopActions)
        applicationDelegate.launcher = stateMachine
        applicationDelegate.desktop = desktopActions
    }

    var body: some Scene {
        MenuBarExtra {
            Group {
                Text("Cove · \(statusText)").font(.headline)

                if canRetry {
                    Button(localized("Retry and Open Chat")) { launcher.openChatOrRecover() }
                }

                Divider()

                if isReady && desktop.providerSetupRequired == true {
                    Button {
                        launcher.openChatOrRecover(destination: .providerSetup)
                    } label: {
                        Label(localized("Set Up Provider…"), systemImage: "key")
                    }
                }

                Button {
                    desktop.showQuickPanel()
                } label: {
                    Label(localized("Open Quick Panel"), systemImage: "macwindow")
                }
                .disabled(isStarting)

                Button {
                    launcher.openChatOrRecover()
                } label: {
                    Label(localized("Open Chat"), systemImage: "bubble.left.and.bubble.right")
                }
                .keyboardShortcut("o")
                .disabled(isStarting)

                Button {
                    launcher.openChatOrRecover(destination: .newChat)
                } label: {
                    Label(localized("New Chat"), systemImage: "square.and.pencil")
                }
                .keyboardShortcut("n")
                .disabled(isStarting)

                Divider()

                Button {
                    launcher.openChatOrRecover(destination: .settings)
                } label: {
                    Label(localized("Settings…"), systemImage: "gearshape")
                }
                .keyboardShortcut(",")
                .disabled(isStarting)

                Menu(localized("Launcher Settings")) {
                    Toggle(localized("Launch at Login"), isOn: Binding(
                        get: { desktop.launchAtLogin },
                        set: { desktop.setLaunchAtLogin($0) }
                    ))
                    if desktop.loginStatus == .requiresApproval {
                        Button(localized("Allow Launch at Login…")) {
                            SMAppService.openSystemSettingsLoginItems()
                        }
                    }
                    Toggle(localized("Quick Panel Shortcut: ⌃⌥C"), isOn: Binding(
                        get: { desktop.shortcutEnabled },
                        set: { desktop.setShortcutEnabled($0) }
                    ))
                }

                Menu(localized("Troubleshooting")) {
                    Button(localized("Restart Local Service")) { desktop.restart() }
                        .disabled(isStarting)
                    Button(localized("Copy Diagnostics")) { desktop.copyDiagnostics() }
                    Button(localized("Open Data Folder")) { desktop.openDataFolder() }
                }

                Divider()

                Menu(updateMenuTitle) {
                    if desktop.availableUpdate != nil {
                        Button(localized("Open Download Page")) { desktop.openAvailableUpdate() }
                        Divider()
                    }
                    Button(localized("Check Stable Releases…")) { desktop.checkForUpdates() }
                        .disabled(desktop.checkingForUpdates)
                    Button(localized("Check Beta Releases…")) { desktop.checkForUpdates(channel: .beta) }
                        .disabled(desktop.checkingForUpdates)
                }
                Menu(localized("Help & Feedback")) {
                    Button(localized("User Guide")) { desktop.openUserGuide() }
                    Button(localized("Report an Issue…")) { desktop.openIssueTracker() }
                }
                Button(localized("About Cove")) { desktop.showAbout() }

                Divider()

                Button(localized("Quit Cove")) {
                    launcher.quit()
                    NSApplication.shared.terminate(nil)
                }
                .keyboardShortcut("q")
            }
            .onAppear {
                desktop.refreshLoginStatus()
                desktop.refreshServiceStatus()
            }
            .onReceive(Timer.publish(every: 15, on: .main, in: .common).autoconnect()) { _ in
                desktop.refreshServiceStatus()
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                desktop.refreshLoginStatus()
                desktop.refreshServiceStatus()
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
            return localized("Stopped")
        case .starting:
            return localized("Starting…")
        case .ready:
            return localized(desktop.providerSetupRequired == true ? "Set Up Required" : "Ready")
        case .failed:
            return localized("Unavailable")
        }
    }

    private var isStarting: Bool {
        if case .starting = launcher.state { return true }
        return false
    }

    private var canRetry: Bool {
        switch launcher.state {
        case .stopped, .failed: return true
        case .starting, .ready: return false
        }
    }

    private var updateMenuTitle: String {
        if desktop.checkingForUpdates { return localized("Checking for Updates…") }
        return localized(desktop.availableUpdate == nil ? "Check for Updates" : "Update Available…")
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
