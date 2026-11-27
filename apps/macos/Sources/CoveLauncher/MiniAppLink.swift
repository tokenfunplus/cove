import Foundation

/// Navigation intents accepted from an external browser. A link carries no authorization.
public enum MiniAppLink: Equatable {
    case apps
    case open(UUID, String)
    case install(String, String, String?)
    case pick(UUID)

    public init?(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "cove", parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil else { return nil }
        if parts.host == "apps", parts.query == nil, parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/" {
            self = .apps
            return
        }
        guard parts.percentEncodedPath.hasPrefix("/") else { return nil }
        let path = parts.percentEncodedPath.dropFirst().components(separatedBy: "/")
        func matches(_ value: String, _ pattern: String) -> Bool {
            value.range(of: pattern, options: .regularExpression) != nil
        }
        switch parts.host {
        case "open":
            guard parts.query == nil, path.count == 2, let id = UUID(uuidString: path[0]),
                  matches(path[1], #"^[A-Za-z][A-Za-z0-9_-]{0,63}$"#) else { return nil }
            self = .open(id, path[1])
        case "install":
            guard path.count == 2, path.allSatisfy({ matches($0, #"^[a-z][a-z0-9-]{0,63}$"#) }) else { return nil }
            let query = parts.queryItems ?? []
            if query.isEmpty { self = .install(path[0], path[1], nil); return }
            guard query.count == 1, query[0].name == "version", let version = query[0].value,
                  version.count <= 32, matches(version, #"^[0-9]+\.[0-9]+\.[0-9]+$"#) else { return nil }
            self = .install(path[0], path[1], version)
        case "pick":
            guard parts.query == nil, path.count == 1, let id = UUID(uuidString: path[0]) else { return nil }
            self = .pick(id)
        default: return nil
        }
    }
}
