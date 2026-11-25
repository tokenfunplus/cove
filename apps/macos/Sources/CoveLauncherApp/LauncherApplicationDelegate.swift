import AppKit
import Carbon
import CoveLauncher

@MainActor
final class LauncherApplicationDelegate: NSObject, NSApplicationDelegate {
    var launcher: LauncherStateMachine?
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

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        launcher?.openChatOrRecover()
        return false
    }
}
