import Foundation

struct LauncherRelease {
    let version: String
    let build: String

    init(info: [String: Any]) {
        version = info["CoveReleaseVersion"] as? String
            ?? info["CFBundleShortVersionString"] as? String
            ?? "0.0.0"
        build = info["CFBundleVersion"] as? String ?? "0"
    }

    var releaseURL: URL {
        URL(string: "https://github.com/tokenfunplus/cove/releases/tag/")!
            .appendingPathComponent("v" + version)
    }
}
