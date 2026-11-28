import AppKit
import CryptoKit
@testable import CoveLauncher

// The default run supplies a synthetic file reply. The interactive run uses
// the Launcher’s production AppKit panels in a separate, temporary instance.
private final class CaptureBrowser: BrowserOpening {
    var launchURL: URL?
    func open(_ url: URL) { launchURL = url }
}

enum FixtureFailure: Error { case mismatch }

func expect(_ condition: Bool) throws {
    if !condition { throw FixtureFailure.mismatch }
}

struct LocalClient {
    let origin: URL
    let token: String
    var csrf = ""

    func json(_ path: String, body: [String: Any]? = nil, status: Int = 200) async throws -> Any {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL else { throw FixtureFailure.mismatch }
        var request = URLRequest(url: url, timeoutInterval: 120)
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
        return data.isEmpty ? [:] : try JSONSerialization.jsonObject(with: data)
    }

    func importFixture(_ raw: Data) async throws -> [String: Any] {
        func post(_ operation: String, reviewed: [String: Any] = [:]) async throws -> [String: Any] {
            guard let url = URL(string: "/api/mini-apps/packages/" + operation, relativeTo: origin) else { throw FixtureFailure.mismatch }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.httpBody = raw
            request.setValue(token, forHTTPHeaderField: "X-Cove-Session-Token")
            request.setValue(csrf, forHTTPHeaderField: "X-Cove-CSRF-Token")
            request.setValue(origin.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(reviewed["id"] as? String, forHTTPHeaderField: "X-Cove-Release-ID")
            request.setValue(reviewed["digest"] as? String, forHTTPHeaderField: "X-Cove-Package-Digest")
            let (data, response) = try await URLSession.shared.data(for: request)
            try expect((response as? HTTPURLResponse)?.statusCode == 200)
            return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        }
        let reviewed = try await post("preview")
        return try await post("install", reviewed: reviewed)
    }

    func call(_ path: String, body: [String: Any]? = nil, status: Int = 200) async throws -> [String: Any] {
        try await json(path, body: body, status: status) as? [String: Any] ?? [:]
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
        let options = Set(CommandLine.arguments.dropFirst(2))
        guard CommandLine.arguments.count >= 2, options.isSubset(of: ["--interactive", "--managed", "--cloud", "--compatible", "--os-handoff"]) else {
            throw FixtureFailure.mismatch
        }
        let interactive = options.contains("--interactive")
        if interactive {
            _ = NSApplication.shared
            NSApp.setActivationPolicy(.accessory)
            NSApp.finishLaunching()
        }
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("cove-mini-app-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: temp) }
        setenv("COVE_DATA_DIR", temp.path, 1)
        setenv("COVE_INSECURE_FILE_SECRET_STORE", "1", 1)
        unsetenv("COVE_APP_CATALOG_URL")
        unsetenv("COVE_APP_CATALOG_PUBLIC_KEY")
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

        let client = try await handoff("cove://install/cove/japanese-review-book?version=1.1.0", "/apps/install/cove/japanese-review-book?version=1.1.0")
        let api = "/api/mini-apps"
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("services/local-service/internal/appcatalog/testdata/legacy-releases/japanese-review-book-1.1.coveapp")
        guard let release = try await client.importFixture(Data(contentsOf: fixture))["id"] as? String,
              let id = try await client.call(api + "/instances", body: ["release_id": release, "name": "Picker fixture", "grants": ["mac.files.pick", "mac.selection.receive", "ai.generate", "records.query", "records.commit"]])["id"] as? String
        else { throw FixtureFailure.mismatch }
        let instance = api + "/instances/" + id
        let other = try await handoff("cove://apps", "/apps")
        let pending = try await client.call(instance + "/files", body: [:])
        guard let op = pending["id"] as? String, let pickerLink = pending["url"] as? String,
              let requestID = UUID(uuidString: op), let link = URL(string: pickerLink), MiniAppLink(link) == .pick(requestID)
        else { throw FixtureFailure.mismatch }
        let text = "The Japanese word for water is mizu. Water freezes at zero degrees Celsius."
        if interactive {
            let file = temp.appendingPathComponent("lesson.txt")
            try text.write(to: file, atomically: true, encoding: .utf8)
            print("In the Mac file picker press Shift-Command-G and choose " + file.path)
            await pickMiniAppText(requestID, service: service)
        } else {
            let claim = try await service.miniAppFileRequest(requestID)
            try expect((try JSONSerialization.jsonObject(with: claim) as? [String: String])?["instance"] == "Picker fixture")
            let reply = try JSONEncoder().encode(["state":"completed", "name":"lesson.txt", "text":text])
            _ = try await service.miniAppFileRequest(requestID, reply: reply)
        }
        let file = try await client.call(instance + "/files/" + op)
        try expect(file["text"] as? String == text)
        _ = try await other.call(instance + "/files/" + op, status: 404)
        var selectedReceipt: UUID?
        if interactive {
            let board = NSPasteboard.withUniqueName()
            defer { board.releaseGlobally() }
            try expect(board.setString(text, forType: .string))
            guard let selection = board.string(forType: .string) else { throw FixtureFailure.mismatch }
            print("In the selection chooser pick a field of the Picker fixture instance.")
            selectedReceipt = await chooseMiniAppForSelection(selection, launcher: launcher, service: service)
        } else {
            let targets = try await service.miniAppSelectionTargets()
            guard let target = (try JSONSerialization.jsonObject(with: targets) as? [[String: Any]])?.first(where: {
                $0["action"] as? String == "review.suggestQuestions" && $0["field"] as? String == "passage"
            }) else { throw FixtureFailure.mismatch }
            let staged = try await service.stageMiniAppSelection(JSONSerialization.data(withJSONObject: ["target": target, "text": text]))
            if let raw = (try JSONSerialization.jsonObject(with: staged) as? [String:String])?["id"] { selectedReceipt = UUID(uuidString: raw) }
        }
        guard let selectedReceipt else { throw FixtureFailure.mismatch }
        let selectionPath = instance + "/native-selection?selection=" + selectedReceipt.uuidString.lowercased()
        let pendingText = try await client.call(selectionPath)
        _ = try await other.call(selectionPath, status: 403)
        guard let selectionID = pendingText["id"] as? String,
              (pendingText["target"] as? [String: Any])?["instance"] as? String == id else { throw FixtureFailure.mismatch }
        let received = try await client.call(instance + "/native-selection", body: ["id":selectionID])
        try expect(received["text"] as? String == text)
        _ = try await client.call(instance + "/native-selection", body: ["id":selectionID], status: 409)
        if options.contains("--managed") {
            try await verifyManagedGeneration(client, instance: instance, temp: temp, text: text)
        }
        if options.contains("--compatible") {
            try await verifyCompatibleGeneration(client, instance: instance, text: text)
        }
        if options.contains("--cloud") {
            try await verifyCloudGeneration(client, instance: instance, text: text)
        }
        launcher.stop()
        let resumed = try await handoff("cove://open/" + id + "/questions", "/apps/" + id + "/questions")
        _ = try await client.call("/api/session", status: 401)
        let details = try await resumed.call(instance)
        try expect((details["instance"] as? [String:Any])?["name"] as? String == "Picker fixture")
        if options.contains("--os-handoff") {
            launcher.stop()
            let serviceURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
            let bundle = serviceURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            try await verifySystemHandoff(bundle: bundle, data: temp, instance: id)
        }
    }
}
