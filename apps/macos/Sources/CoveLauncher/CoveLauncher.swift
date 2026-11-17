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
        guard case .stopped = state else {
            return
        }
        do {
            try start()
            openChat()
        } catch {
            return
        }
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

    public func openChat(destination: ChatLaunchDestination = .chat) {
        guard case let .ready(readiness) = state,
              var components = URLComponents(url: readiness.baseURL, resolvingAgainstBaseURL: false)
        else {
            return
        }
        components.path = "/launch"
        let launchToken: String
        do {
            launchToken = try service.mintBrowserLaunchToken()
        } catch {
            state = .failed(error.localizedDescription)
            return
        }
        components.queryItems = [URLQueryItem(name: "token", value: launchToken)]
        if destination != .chat {
            components.queryItems?.append(URLQueryItem(name: "intent", value: destination.rawValue))
        }
        guard let url = components.url else {
            return
        }
        browser.open(url)
    }

    public func serviceExited() {
        guard case .stopped = state else {
            state = .failed("The Local Service stopped unexpectedly.")
            return
        }
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
