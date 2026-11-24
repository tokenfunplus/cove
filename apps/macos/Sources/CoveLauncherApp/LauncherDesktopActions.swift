import AppKit
import Combine
import CoveLauncher
import ServiceManagement

@MainActor
final class LauncherDesktopActions: ObservableObject {
    @Published private(set) var loginStatus = SMAppService.mainApp.status
    @Published private(set) var shortcutEnabled = false
    @Published private(set) var checkingForUpdates = false
    @Published private var updateAvailability = UpdateAvailability()
    @Published private(set) var providerSetupRequired: Bool?

    let release = LauncherRelease(info: Bundle.main.infoDictionary ?? [:])
    private let launcher: LauncherStateMachine
    private let browser: BrowserOpening
    private let resources: Bundle
    private let updates: UpdateChecker
    private let serviceStatus: any ServiceStatusReading
    private var checkingServiceStatus = false
    private var shortcut: GlobalChatShortcut?
    private var serviceObservation: AnyCancellable?
    private var panelReadiness: ServiceReadiness?
    private lazy var quickPanel = QuickPanelController(
        launchURL: { [weak launcher] in launcher?.quickPanelLaunchURL() },
        openChat: { [weak launcher] conversationID in
            guard let launcher else { return false }
            if let conversationID {
                guard let id = UUID(uuidString: conversationID) else { return false }
                return launcher.openConversationInBrowser(id)
            }
            return launcher.openChatOrRecover()
        },
        openProviderSettings: { [weak launcher] in launcher?.openChatOrRecover(destination: .providerSetup) ?? false },
        reauthorize: { [weak launcher] origin in await launcher?.refreshQuickPanelSession(expectedOrigin: origin) }
    )

    init(launcher: LauncherStateMachine, browser: BrowserOpening, resources: Bundle,
         serviceStatus: any ServiceStatusReading, updates: UpdateChecker? = nil) {
        self.launcher = launcher
        self.browser = browser
        self.resources = resources
        self.serviceStatus = serviceStatus
        self.updates = updates ?? UpdateChecker(
            currentVersion: release.version,
            manifestURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "CoveUpdateManifestURL") as? String
                ?? "https://github.com/tokenfunplus/cove/releases/latest/download/update.json")!,
            requester: URLSessionUpdateRequester()
        )
        shortcut = GlobalChatShortcut { [weak self] in
            self?.quickPanel.toggle()
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
        serviceObservation = launcher.$state.removeDuplicates().sink { [weak self] state in
            Task { @MainActor in
                guard let self, self.launcher.state == state else { return }
                self.serviceStateChanged()
            }
        }
    }

    var launchAtLogin: Bool {
        loginStatus == .enabled || loginStatus == .requiresApproval
    }

    var availableUpdate: AppUpdate? { updateAvailability.update }

    func refreshLoginStatus() {
        loginStatus = SMAppService.mainApp.status
    }

    func refreshServiceStatus() {
        guard case let .ready(readiness) = launcher.state else {
            providerSetupRequired = nil
            return
        }
        guard !checkingServiceStatus else { return }
        checkingServiceStatus = true
        serviceStatus.fetchStatus { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.checkingServiceStatus = false
                guard self.launcher.state == .ready(readiness) else { return }
                self.providerSetupRequired = try? result.get().providerSetupRequired
            }
        }
    }

    private func serviceStateChanged() {
        providerSetupRequired = nil
        if case let .ready(readiness) = launcher.state {
            if let previous = panelReadiness, previous != readiness, previous.baseURL == readiness.baseURL {
                quickPanel.serviceDidChange(baseURL: nil)
            }
            panelReadiness = readiness
            quickPanel.serviceDidChange(baseURL: readiness.baseURL)
            if shortcutEnabled { quickPanel.prepare() }
        } else {
            panelReadiness = nil
            quickPanel.serviceDidChange(baseURL: nil)
        }
        refreshServiceStatus()
    }

    func showQuickPanel() {
        // Present after the menu action returns so closing it cannot take focus back.
        DispatchQueue.main.async { [weak self] in self?.quickPanel.show() }
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
            if enabled, case .ready = launcher.state { quickPanel.prepare() }
        } catch {
            showNotice("Shortcut unavailable.", detail: "Control-Option-C may already be used by another app.")
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
            .credits: NSAttributedString(string: text("Release Notes"), attributes: [.link: release.releaseURL]),
        ])
    }

    func restart() {
        do { try launcher.restart() }
        catch { showNotice("Local Service unavailable.", detail: "Try restarting Cove.") }
    }

    func openAvailableUpdate() {
        if let availableUpdate { browser.open(availableUpdate.downloadURL) }
    }

    func checkForUpdates(channel: UpdateChannel = .stable) {
        guard !checkingForUpdates else { return }
        checkingForUpdates = true
        updates.check(channel: channel) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.checkingForUpdates = false
                switch result {
                case let .success(update?):
                    self.updateAvailability.record(update, channel: channel)
                    let alert = NSAlert()
                    alert.messageText = self.text("Update Available")
                    alert.informativeText = String(format: self.text("A new version %@ is available."), update.version)
                    alert.addButton(withTitle: self.text("Open Download Page"))
                    alert.addButton(withTitle: self.text("Later"))
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    if alert.runModal() == .alertFirstButtonReturn { self.browser.open(update.downloadURL) }
                case .success(nil):
                    self.updateAvailability.record(nil, channel: channel)
                    self.showNotice(channel == .beta ? "No newer beta or stable release was found." : "Cove is up to date.")
                case let .failure(error):
                    let alert = NSAlert()
                    alert.messageText = self.text("Update check unavailable.")
                    alert.informativeText = self.text(error as? UpdateError == .channelUnavailable
                        ? "No release metadata is available for this channel. You can browse official releases."
                        : "Check your connection or browse official releases to find an update.")
                    alert.addButton(withTitle: self.text("Open Releases"))
                    alert.addButton(withTitle: self.text("Later"))
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    if alert.runModal() == .alertFirstButtonReturn {
                        self.browser.open(URL(string: "https://github.com/tokenfunplus/cove/releases")!)
                    }
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
