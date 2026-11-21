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
    case channelUnavailable

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
        case .channelUnavailable:
            return "No release metadata is available for this channel."
        }
    }
}

public enum UpdateChannel: Hashable, Sendable {
    case stable
    case beta
}

public struct UpdateAvailability {
    private var updates: [UpdateChannel: AppUpdate] = [:]

    public init() {}

    public var update: AppUpdate? {
        updates.values.max {
            guard let left = Version($0.version), let right = Version($1.version) else { return false }
            return left < right
        }
    }

    public mutating func record(_ update: AppUpdate?, channel: UpdateChannel) {
        updates[channel] = update
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
        channel: UpdateChannel = .stable,
        completion: @escaping @Sendable (Result<AppUpdate?, Error>) -> Void
    ) {
        guard let current = Version(currentVersion) else {
            completion(.failure(UpdateError.invalidCurrentVersion))
            return
        }
        let url = channel == .stable ? manifestURL
            : URL(string: "https://api.github.com/repos/tokenfunplus/cove/releases?per_page=100")!
        guard isHTTPS(url) else {
            completion(.failure(UpdateError.invalidManifestURL))
            return
        }
        requester.get(url: url) { data, statusCode in
            if statusCode == 404 {
                completion(.failure(UpdateError.channelUnavailable))
                return
            }
            guard statusCode == 200, let data else {
                completion(.failure(UpdateError.requestFailed))
                return
            }
            do {
                if channel == .beta {
                    let releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
                    let candidates = releases.compactMap { release -> (Version, AppUpdate)? in
                        guard !release.draft, release.tag.hasPrefix("v"),
                              let version = Version(String(release.tag.dropFirst())),
                              version.prerelease.isEmpty || ["beta", "rc"].contains(version.prerelease[0])
                        else { return nil }
                        return (version, AppUpdate(
                            version: String(release.tag.dropFirst()),
                            downloadURL: URL(string: "https://github.com/tokenfunplus/cove/releases/tag/")!.appendingPathComponent(release.tag)
                        ))
                    }
                    guard !candidates.isEmpty else { throw UpdateError.channelUnavailable }
                    let latest = candidates.max { $0.0 < $1.0 }!
                    completion(.success(latest.0 > current ? latest.1 : nil))
                    return
                }
                let manifest = try UpdateManifest.parse(data)
                let remoteVersion = Version(manifest.version)!
                guard remoteVersion.prerelease.isEmpty, remoteVersion > current else {
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

private struct GitHubRelease: Decodable {
    let tag: String
    let draft: Bool

    enum CodingKeys: String, CodingKey {
        case tag = "tag_name"
        case draft
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
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("Cove", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { data, response, _ in
            completion(data, (response as? HTTPURLResponse)?.statusCode)
        }.resume()
    }
}

private func isHTTPS(_ url: URL) -> Bool {
    url.scheme?.lowercased() == "https" && url.host != nil
}

private struct Version: Comparable, Sendable {
    private let components: [Int]
    let prerelease: [String]

    init?(_ value: String) {
        guard !value.isEmpty else { return nil }
        let build = value.split(separator: "+", omittingEmptySubsequences: false)
        guard build.count <= 2, build.count == 1 || validIdentifiers(String(build[1]), numericLeadingZeros: true) else { return nil }
        let version = build[0].split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let parts = version[0].split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) && ($0.count == 1 || $0.first != "0") }),
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
        if version.count == 2 {
            guard validIdentifiers(String(version[1]), numericLeadingZeros: false) else { return nil }
            prerelease = version[1].split(separator: ".").map(String.init)
        } else { prerelease = [] }
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
        if lhs.prerelease.isEmpty { return false }
        if rhs.prerelease.isEmpty { return true }
        for (left, right) in zip(lhs.prerelease, rhs.prerelease) where left != right {
            let leftNumeric = left.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
            let rightNumeric = right.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
            if leftNumeric && rightNumeric {
                return left.count == right.count ? left < right : left.count < right.count
            }
            if leftNumeric != rightNumeric { return leftNumeric }
            return left < right
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}

private func validIdentifiers(_ text: String, numericLeadingZeros: Bool) -> Bool {
    text.split(separator: ".", omittingEmptySubsequences: false).allSatisfy { identifier in
        guard !identifier.isEmpty, identifier.utf8.allSatisfy({
            ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45
        }) else { return false }
        let numeric = identifier.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
        return numericLeadingZeros || !numeric || identifier.count == 1 || identifier.first != "0"
    }
}
