import AppKit
import Combine
import CoveLauncher
import ServiceManagement

@MainActor
final class LauncherDesktopActions: ObservableObject {
    @Published private(set) var loginStatus = SMAppService.mainApp.status
    @Published private(set) var shortcutEnabled = false
    @Published private(set) var checkingForUpdates = false

    let release = LauncherRelease(info: Bundle.main.infoDictionary ?? [:])
    private let launcher: LauncherStateMachine
    private let browser: BrowserOpening
    private let resources: Bundle
    private let updates: UpdateChecker
    private var shortcut: GlobalChatShortcut?

    init(launcher: LauncherStateMachine, browser: BrowserOpening, resources: Bundle) {
        self.launcher = launcher
        self.browser = browser
        self.resources = resources
        updates = UpdateChecker(
            currentVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
            manifestURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "CoveUpdateManifestURL") as? String
                ?? "https://github.com/tokenfunplus/cove/releases/latest/download/update.json")!,
            requester: URLSessionUpdateRequester()
        )
        shortcut = GlobalChatShortcut { [weak launcher] in
            if case .ready = launcher?.state { launcher?.openChat() }
            else { launcher?.startIfNeededAndOpenChat() }
        }
        if UserDefaults.standard.bool(forKey: "GlobalChatShortcutEnabled") {
            do {
                try shortcut?.enable()
                shortcutEnabled = true
            } catch {
                // Keep the saved preference so a temporary conflict can recover on restart.
                shortcutEnabled = false
            }
        }
    }

    var launchAtLogin: Bool {
        loginStatus == .enabled || loginStatus == .requiresApproval
    }

    func refreshLoginStatus() {
        loginStatus = SMAppService.mainApp.status
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            refreshLoginStatus()
            if loginStatus == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch {
            refreshLoginStatus()
            showNotice("Launch at Login unavailable.", detail: "Manage Cove in System Settings > General > Login Items.")
        }
    }

    func setShortcutEnabled(_ enabled: Bool) {
        do {
            if enabled { try shortcut?.enable() }
            else { shortcut?.disable() }
            shortcutEnabled = enabled
            UserDefaults.standard.set(enabled, forKey: "GlobalChatShortcutEnabled")
        } catch {
            showNotice("Shortcut unavailable.", detail: "Control-Option-Space may already be used by another app.")
        }
    }

    func openReleaseNotes() { browser.open(release.releaseURL) }

    func openUserGuide() {
        browser.open(URL(string: "https://github.com/tokenfunplus/cove/blob/main/docs/user-guide.md")!)
    }

    func openIssueTracker() {
        browser.open(URL(string: "https://github.com/tokenfunplus/cove/issues/new")!)
    }

    func openDataFolder() {
        let path = ProcessInfo.processInfo.environment["COVE_DATA_DIR"]
        let directory = path.map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("cove", isDirectory: true)
        NSWorkspace.shared.open(directory)
    }

    func copyDiagnostics() {
        let report = launcherDiagnosticReport(
            release: release, state: launcher.state,
            launchAtLogin: launchAtLogin, shortcutEnabled: shortcutEnabled
        )
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
    }

    func showAbout() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            .applicationName: "Cove",
            .applicationVersion: release.version,
            .version: release.build,
        ])
    }

    func restart() {
        do { try launcher.restart() }
        catch { showNotice("Local Service unavailable.", detail: "Try restarting Cove.") }
    }

    func checkForUpdates() {
        guard !checkingForUpdates else { return }
        checkingForUpdates = true
        updates.check { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.checkingForUpdates = false
                switch result {
                case let .success(update?):
                    let alert = NSAlert()
                    alert.messageText = self.text("Update Available")
                    alert.informativeText = String(format: self.text("A new version %@ is available."), update.version)
                    alert.addButton(withTitle: self.text("Open Download Page"))
                    alert.addButton(withTitle: self.text("Later"))
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    if alert.runModal() == .alertFirstButtonReturn { self.browser.open(update.downloadURL) }
                case .success(nil):
                    self.showNotice("Cove is up to date.")
                case .failure:
                    self.showNotice("Update check unavailable.")
                }
            }
        }
    }

    private func text(_ key: String) -> String {
        String(localized: String.LocalizationValue(key), bundle: resources)
    }

    private func showNotice(_ title: String, detail: String = "") {
        let alert = NSAlert()
        alert.messageText = text(title)
        alert.informativeText = text(detail)
        NSApplication.shared.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
