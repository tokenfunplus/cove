import Combine
import Foundation

public protocol ServiceManaging: AnyObject {
    func start() throws -> ServiceReadiness
    func mintBrowserLaunchToken() throws -> String
    func stop()
}

public protocol BrowserOpening: AnyObject {
    func open(_ url: URL)
}

public struct ServiceReadiness: Equatable, Sendable {
    public let baseURL: URL
    public let launchToken: String

    public static func parse(_ line: String) throws -> ServiceReadiness {
        let data = Data(line.utf8)
        let payload: ReadinessPayload
        do {
            payload = try JSONDecoder().decode(ReadinessPayload.self, from: data)
        } catch {
            throw LauncherError.invalidReadiness
        }

        guard let url = URL(string: payload.url),
              url.scheme == "http",
              url.host == "127.0.0.1",
              url.port != nil,
              url.path == "" || url.path == "/",
              decodedToken(payload.launchToken)?.count == 32
        else {
            throw LauncherError.invalidReadiness
        }

        return ServiceReadiness(baseURL: url, launchToken: payload.launchToken)
    }
}

public enum LauncherState: Equatable {
    case stopped
    case starting
    case ready(ServiceReadiness)
    case failed(String)
}

public enum ChatLaunchDestination: String {
    case chat
    case newChat = "new-chat"
    case settings
    case apps
    case providerSetup = "provider-setup"
}

@MainActor
public final class LauncherStateMachine: ObservableObject {
    @Published public private(set) var state: LauncherState = .stopped

    private let service: ServiceManaging
    private let browser: BrowserOpening

    public init(service: ServiceManaging, browser: BrowserOpening) {
        self.service = service
        self.browser = browser
    }

    public func start() throws {
        state = .starting
        do {
            state = .ready(try service.start())
        } catch {
            state = .failed(error.localizedDescription)
            throw error
        }
    }

    public func startIfNeededAndOpenChat() {
        startAtLaunch(isLoginItem: false)
    }

    public func startAtLaunch(isLoginItem: Bool, opensChat: Bool = true) {
        guard case .stopped = state else {
            return
        }
        do {
            try start()
            if !isLoginItem && opensChat { openChat() }
        } catch {
            return
        }
    }

    @discardableResult
    public func openChatOrRecover(destination: ChatLaunchDestination = .chat) -> Bool {
        ensureReady() && openChat(destination: destination)
    }

    public func openConversationInBrowser(_ id: UUID) -> Bool {
        guard ensureReady(), let url = launchURL(intent: "conversation", conversationID: id) else { return false }
        browser.open(url)
        return true
    }

    public func openMiniApp(_ link: MiniAppLink) {
        var items: [URLQueryItem]
        switch link {
        case .apps: items = []
        case let .open(id, view):
            items = [.init(name: "instance", value: id.uuidString.lowercased()), .init(name: "view", value: view)]
        case let .install(publisher, app, version):
            items = [.init(name: "publisher", value: publisher), .init(name: "app", value: app)]
            if let version { items.append(.init(name: "version", value: version)) }
        case .pick: return
        }
        guard ensureReady(), let url = launchURL(intent: "apps", additionalItems: items) else { return }
        browser.open(url)
    }

    public func quickPanelLaunchURL() -> URL? {
        guard ensureReady() else { return nil }
        return launchURL(intent: "quick-panel")
    }

    public func refreshQuickPanelSession(expectedOrigin: URL) async -> String? {
        guard case let .ready(readiness) = state,
              expectedOrigin.scheme == readiness.baseURL.scheme,
              expectedOrigin.host == readiness.baseURL.host,
              expectedOrigin.port == readiness.baseURL.port,
              let launch = launchURL(intent: "quick-panel")
        else { return nil }
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        let request = URLRequest(url: launch, timeoutInterval: 5)
        guard let (_, response) = try? await session.data(for: request, delegate: LaunchRedirectObserver()),
              state == .ready(readiness),
              let response = response as? HTTPURLResponse,
              response.statusCode == 303,
              let location = response.value(forHTTPHeaderField: "Location"),
              let parts = URLComponents(string: location),
              parts.scheme == nil, parts.host == nil, parts.path == "/",
              parts.query == "surface=quick-panel",
              let fragment = parts.percentEncodedFragment
        else { return nil }
        var parameters = URLComponents()
        parameters.percentEncodedQuery = fragment
        let token = parameters.queryItems?.first { $0.name == "cove-session" }?.value
        guard let token, decodedToken(token)?.count == 32 else { return nil }
        return token
    }

    public func stop() {
        service.stop()
        state = .stopped
    }

    public func restart() throws {
        stop()
        try start()
    }

    public func quit() {
        stop()
    }

    @discardableResult
    public func openChat(destination: ChatLaunchDestination = .chat) -> Bool {
        guard let url = launchURL(intent: destination == .chat ? nil : destination.rawValue) else { return false }
        browser.open(url)
        return true
    }

    private func ensureReady() -> Bool {
        switch state {
        case .starting: return false
        case .ready: return true
        case .stopped, .failed:
            do {
                stop()
                try start()
                return true
            } catch {
                return false
            }
        }
    }

    private func launchURL(intent: String?, conversationID: UUID? = nil, additionalItems: [URLQueryItem] = []) -> URL? {
        guard case let .ready(readiness) = state,
              var components = URLComponents(url: readiness.baseURL, resolvingAgainstBaseURL: false)
        else {
            return nil
        }
        components.path = "/launch"
        let launchToken: String
        do {
            launchToken = try service.mintBrowserLaunchToken()
        } catch {
            state = .failed(error.localizedDescription)
            return nil
        }
        components.queryItems = [URLQueryItem(name: "token", value: launchToken)]
        if let intent {
            components.queryItems?.append(URLQueryItem(name: "intent", value: intent))
        }
        if let conversationID {
            components.queryItems?.append(URLQueryItem(name: "conversation_id", value: conversationID.uuidString.lowercased()))
        }
        components.queryItems?.append(contentsOf: additionalItems)
        return components.url
    }

    public func serviceExited() {
        guard case .stopped = state else {
            state = .failed("The Local Service stopped unexpectedly.")
            return
        }
    }
}

final class LaunchRedirectObserver: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // The session fragment is only needed in the already mounted panel.
        completionHandler(nil)
    }
}

public enum LauncherError: LocalizedError {
    case invalidReadiness
    case serviceDidNotBecomeReady

    public var errorDescription: String? {
        switch self {
        case .invalidReadiness:
            return "The Local Service returned an invalid readiness response."
        case .serviceDidNotBecomeReady:
            return "The Local Service did not become ready in time."
        }
    }
}

private struct ReadinessPayload: Decodable {
    let url: String
    let launchToken: String

    enum CodingKeys: String, CodingKey {
        case url
        case launchToken = "launch_token"
    }
}

private func decodedToken(_ token: String) -> Data? {
    let normalized = token.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let padding = String(repeating: "=", count: (4 - normalized.count % 4) % 4)
    return Data(base64Encoded: normalized + padding)
}
