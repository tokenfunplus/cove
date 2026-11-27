import Foundation

// Exercise the actual Launcher handoff and private picker transport without
// opening a browser, a Finder window, or a file outside the fixture directory.
private final class CaptureBrowser: BrowserOpening {
    var launchURL: URL?
    func open(_ url: URL) { launchURL = url }
}

private enum FixtureFailure: Error { case mismatch }

private func expect(_ condition: Bool) throws {
    if !condition { throw FixtureFailure.mismatch }
}

private struct LocalClient {
    let origin: URL
    let token: String
    var csrf = ""

    func call(_ path: String, body: [String: Any]? = nil, status: Int = 200) async throws -> [String: Any] {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL else { throw FixtureFailure.mismatch }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.setValue(token, forHTTPHeaderField: "X-Cove-Session-Token")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(origin.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue(csrf, forHTTPHeaderField: "X-Cove-CSRF-Token")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request, delegate: LaunchRedirectObserver())
        try expect((response as? HTTPURLResponse)?.statusCode == status)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }
}

@main
private enum MiniAppLauncherAcceptance {
    @MainActor
    static func main() async {
        do {
            try await run()
            print("Launcher Mini App acceptance passed.")
        } catch {
            // A transport error may contain a one-time launch URL.
            fputs("Launcher Mini App acceptance failed.\n", stderr)
            exit(1)
        }
    }

    @MainActor
    static func run() async throws {
        guard CommandLine.arguments.count == 2 else { throw FixtureFailure.mismatch }
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("cove-mini-app-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: temp) }
        setenv("COVE_DATA_DIR", temp.path, 1)
        setenv("COVE_INSECURE_FILE_SECRET_STORE", "1", 1)
        let service = BundledServiceManager(executableURL: URL(fileURLWithPath: CommandLine.arguments[1]), preferredPort: 19760,
                                            recoveryStart: 19761, recoveryEnd: 19790, insecureFileSecretStore: true)
        let browser = CaptureBrowser()
        let launcher = LauncherStateMachine(service: service, browser: browser)
        defer { launcher.stop() }

        func handoff(_ link: String, _ expected: String) async throws -> LocalClient {
            guard let url = URL(string: link), let intent = MiniAppLink(url) else { throw FixtureFailure.mismatch }
            browser.launchURL = nil
            launcher.openMiniApp(intent)
            guard let launch = browser.launchURL, case let .ready(r) = launcher.state else { throw FixtureFailure.mismatch }
            let (_, response) = try await URLSession.shared.data(for: URLRequest(url: launch), delegate: LaunchRedirectObserver())
            guard let http = response as? HTTPURLResponse, http.statusCode == 303,
                  let location = http.value(forHTTPHeaderField: "Location"), let fragment = location.components(separatedBy: "#").last,
                  location.hasPrefix(expected + "#"), fragment.hasPrefix("cove-session=") else { throw FixtureFailure.mismatch }
            let (_, replay) = try await URLSession.shared.data(for: URLRequest(url: launch), delegate: LaunchRedirectObserver())
            try expect((replay as? HTTPURLResponse)?.statusCode == 401)
            var client = LocalClient(origin: r.baseURL, token: String(fragment.dropFirst("cove-session=".count)))
            guard let csrf = try await client.call("/api/session")["csrf_token"] as? String else { throw FixtureFailure.mismatch }
            client.csrf = csrf
            return client
        }

        let client = try await handoff("cove://install/cove/japanese-review-book?version=1.0.0", "/apps/install/cove/japanese-review-book?version=1.0.0")
        let api = "/api/mini-apps"
        let catalog = try await client.call(api + "/catalog")
        guard let entries = catalog["packages"] as? [[String: Any]], let book = entries.first(where: { $0["app"] as? String == "japanese-review-book" }),
              let digest = book["digest"] as? String,
              let release = try await client.call(api + "/catalog/cove/japanese-review-book/1.0.0/install", body: ["digest": digest])["id"] as? String,
              let id = try await client.call(api + "/instances", body: ["release_id": release, "name": "Picker fixture", "grants": ["mac.files.pick"]])["id"] as? String
        else { throw FixtureFailure.mismatch }
        let instance = api + "/instances/" + id
        let other = try await handoff("cove://apps", "/apps")
        let pending = try await client.call(instance + "/files", body: [:])
        guard let op = pending["id"] as? String, let pickerLink = pending["url"] as? String,
              let requestID = UUID(uuidString: op), let link = URL(string: pickerLink), MiniAppLink(link) == .pick(requestID)
        else { throw FixtureFailure.mismatch }
        let claim = try await service.miniAppFileRequest(requestID)
        try expect((try JSONSerialization.jsonObject(with: claim) as? [String: String])?["instance"] == "Picker fixture")
        let reply = try JSONEncoder().encode(["state":"completed", "name":"fixture.txt", "text":"Fixture-only selected text"])
        _ = try await service.miniAppFileRequest(requestID, reply: reply)
        let file = try await client.call(instance + "/files/" + op)
        try expect(file["text"] as? String == "Fixture-only selected text")
        _ = try await other.call(instance + "/files/" + op, status: 404)
        launcher.stop()
        let resumed = try await handoff("cove://open/" + id + "/questions", "/apps/" + id + "/questions")
        _ = try await client.call("/api/session", status: 401)
        let details = try await resumed.call(instance)
        try expect((details["instance"] as? [String:Any])?["name"] as? String == "Picker fixture")
    }
}
