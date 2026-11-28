import AppKit
import Carbon
import CoveLauncher

@MainActor
final class LauncherApplicationDelegate: NSObject, NSApplicationDelegate {
    var launcher: LauncherStateMachine?
    weak var service: BundledServiceManager?
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first, let link = MiniAppLink(url) else { return }
        if case let .pick(id) = link {
            guard let service else { return }
            Task { await pickMiniAppText(id, service: service) }
        } else {
            if launcher?.openMiniApp(link) != true {
                miniAppNotice("Cove could not open this app. Reopen Cove and try the link again.")
            }
        }
    }

    weak var desktop: LauncherDesktopActions?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        let launchReason = event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue
        let isDefaultLaunch = (notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? Bool) != false
        NSApp.servicesProvider = self
        launcher?.startAtLaunch(
            isLoginItem: launchReason == keyAELaunchedAsLogInItem,
            opensChat: isDefaultLaunch && launchReason != keyAELaunchedAsServiceItem
        )
    }

    @objc(askCove:userData:error:)
    func askCove(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>?) {
        do {
            guard let desktop else { throw DesktopIntakeError.unavailable }
            guard let text = pasteboard.string(forType: .string) else { throw DesktopIntakeError.emptySelection }
            try desktop.stageImport(DesktopImport(text: text))
        } catch let failure {
            error?.pointee = failure.localizedDescription as NSString
        }
    }

    @objc(sendToMiniApp:userData:error:)
    func sendToMiniApp(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>?) {
        guard let text = pasteboard.string(forType: .string), !text.isEmpty, text.utf8.count <= 60000,
              let launcher, let service else {
            error?.pointee = "Select up to 60,000 bytes of text and reopen Cove." as NSString
            return
        }
        Task { await chooseMiniAppForSelection(text, launcher: launcher, service: service) }
    }

    func applicationWillTerminate(_ notification: Notification) {
        launcher?.stop()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        launcher?.openChatOrRecover()
        return false
    }
}
