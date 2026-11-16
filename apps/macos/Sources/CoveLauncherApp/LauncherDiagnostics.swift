import Foundation
import CoveLauncher

func launcherDiagnosticReport(
    release: LauncherRelease, state: LauncherState, launchAtLogin: Bool, shortcutEnabled: Bool
) -> String {
    let service: String
    switch state {
    case .stopped: service = "stopped"
    case .starting: service = "starting"
    case .ready: service = "ready"
    case .failed: service = "unavailable"
    }
    // Use an allowlist of scalar status fields; never include readiness tokens or errors.
    return """
    Cove: \(release.version)
    Build: \(release.build)
    macOS: \(ProcessInfo.processInfo.operatingSystemVersionString)
    Architecture: arm64
    Local Service: \(service)
    Launch at Login: \(launchAtLogin ? "registered" : "off")
    Global Shortcut: \(shortcutEnabled ? "on" : "off")
    """
}
