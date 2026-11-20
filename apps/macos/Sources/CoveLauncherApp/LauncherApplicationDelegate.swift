import AppKit
import Carbon
import CoveLauncher

@MainActor
final class LauncherApplicationDelegate: NSObject, NSApplicationDelegate {
    var launcher: LauncherStateMachine?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        let isLoginItem = event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
        launcher?.startAtLaunch(isLoginItem: isLoginItem)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        launcher?.openChatOrRecover()
        return false
    }
}
