import Foundation

public struct LauncherServiceStatus: Decodable, Equatable, Sendable {
    public let providerSetupRequired: Bool

    enum CodingKeys: String, CodingKey {
        case providerSetupRequired = "provider_setup_required"
    }
}

public protocol ServiceStatusReading {
    func fetchStatus(completion: @escaping @Sendable (Result<LauncherServiceStatus, Error>) -> Void)
}
