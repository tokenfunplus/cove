import Foundation

public protocol UpdateRequesting {
    func get(
        url: URL,
        completion: @escaping @Sendable (Data?, Int?) -> Void
    )
}

public struct AppUpdate: Equatable, Sendable {
    public let version: String
    public let downloadURL: URL

    public init(version: String, downloadURL: URL) {
        self.version = version
        self.downloadURL = downloadURL
    }
}

public struct UpdateManifest: Decodable, Sendable {
    public let version: String
    public let downloadURL: URL

    enum CodingKeys: String, CodingKey {
        case version
        case downloadURL = "download_url"
    }

    public static func parse(_ data: Data) throws -> UpdateManifest {
        let manifest: UpdateManifest
        do {
            manifest = try JSONDecoder().decode(UpdateManifest.self, from: data)
        } catch {
            throw UpdateError.invalidManifest
        }
        guard !manifest.version.isEmpty,
              Version(manifest.version) != nil,
              isHTTPS(manifest.downloadURL)
        else {
            throw UpdateError.invalidManifest
        }
        return manifest
    }
}

public enum UpdateError: LocalizedError, Equatable {
    case invalidManifestURL
    case invalidCurrentVersion
    case requestFailed
    case invalidManifest

    public var errorDescription: String? {
        switch self {
        case .invalidManifestURL:
            return "The update manifest URL is not secure."
        case .invalidCurrentVersion:
            return "The current app version is invalid."
        case .requestFailed:
            return "The update manifest could not be reached."
        case .invalidManifest:
            return "The update manifest is invalid."
        }
    }
}

public final class UpdateChecker: @unchecked Sendable {
    private let currentVersion: String
    private let manifestURL: URL
    private let requester: any UpdateRequesting

    public init(
        currentVersion: String,
        manifestURL: URL,
        requester: any UpdateRequesting
    ) {
        self.currentVersion = currentVersion
        self.manifestURL = manifestURL
        self.requester = requester
    }

    public func check(
        completion: @escaping @Sendable (Result<AppUpdate?, Error>) -> Void
    ) {
        guard isHTTPS(manifestURL) else {
            completion(.failure(UpdateError.invalidManifestURL))
            return
        }
        requester.get(url: manifestURL) { data, statusCode in
            guard statusCode == 200, let data else {
                completion(.failure(UpdateError.requestFailed))
                return
            }
            do {
                let manifest = try UpdateManifest.parse(data)
                guard let currentVersion = Version(self.currentVersion),
                      let remoteVersion = Version(manifest.version)
                else {
                    completion(.failure(UpdateError.invalidCurrentVersion))
                    return
                }
                guard remoteVersion > currentVersion else {
                    completion(.success(nil))
                    return
                }
                completion(.success(AppUpdate(version: manifest.version, downloadURL: manifest.downloadURL)))
            } catch {
                completion(.failure(error))
            }
        }
    }
}

public final class URLSessionUpdateRequester: UpdateRequesting {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func get(
        url: URL,
        completion: @escaping @Sendable (Data?, Int?) -> Void
    ) {
        session.dataTask(with: URLRequest(url: url)) { data, response, _ in
            completion(data, (response as? HTTPURLResponse)?.statusCode)
        }.resume()
    }
}

private func isHTTPS(_ url: URL) -> Bool {
    url.scheme?.lowercased() == "https" && url.host != nil
}

private struct Version: Comparable, Sendable {
    private let components: [Int]

    init?(_ value: String) {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard !parts.isEmpty,
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let components = parts.map({ Int($0) }).reduce(into: [Int]?([]), { result, component in
                  guard let component else {
                      result = nil
                      return
                  }
                  result?.append(component)
              })
        else {
            return nil
        }
        self.components = components
    }

    static func < (lhs: Version, rhs: Version) -> Bool {
        let count = max(lhs.components.count, rhs.components.count)
        for index in 0 ..< count {
            let left = index < lhs.components.count ? lhs.components[index] : 0
            let right = index < rhs.components.count ? rhs.components[index] : 0
            if left != right {
                return left < right
            }
        }
        return false
    }
}
