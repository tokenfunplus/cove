import Foundation

public protocol ServiceProcess: AnyObject {
    var isRunning: Bool { get }

    func terminate()
    func waitUntilExit()
    func stopReadingOutput()
}

public protocol ServiceProcessLaunching {
    func launch(
        executableURL: URL,
        arguments: [String],
        onOutput: @escaping @Sendable (Data) -> Void,
        onTermination: @escaping @Sendable () -> Void
    ) throws -> any ServiceProcess
}

public protocol ControlRequesting {
    func post(
        url: URL,
        controlToken: String,
        completion: @escaping @Sendable (Data?, Int?) -> Void
    )
}

public protocol ServiceClock {
    func wait(on semaphore: DispatchSemaphore, timeout: TimeInterval) -> DispatchTimeoutResult
}

public protocol ServiceFileSystem {
    func isExecutableFile(at url: URL) -> Bool
}

public final class BundledServiceManager: ServiceManaging, ServiceStatusReading, @unchecked Sendable {
    public var onUnexpectedExit: (() -> Void)?

    private let executableURL: URL
    private let preferredPort: Int
    private let recoveryStart: Int
    private let recoveryEnd: Int
    private let insecureFileSecretStore: Bool
    private let controlToken: String
    private let processLauncher: any ServiceProcessLaunching
    private let controlRequester: any ControlRequesting
    private let clock: any ServiceClock
    private let fileSystem: any ServiceFileSystem
    private let lock = NSLock()
    private var running: RunningService?

    public init(
        executableURL: URL,
        preferredPort: Int = 19421,
        recoveryStart: Int = 19421,
        recoveryEnd: Int = 19521,
        insecureFileSecretStore: Bool = false,
        processLauncher: any ServiceProcessLaunching = FoundationProcessLauncher(),
        controlRequester: any ControlRequesting = URLSessionControlRequester(),
        clock: any ServiceClock = DispatchServiceClock(),
        fileSystem: any ServiceFileSystem = FoundationServiceFileSystem()
    ) {
        self.executableURL = executableURL
        self.preferredPort = preferredPort
        self.recoveryStart = recoveryStart
        self.recoveryEnd = recoveryEnd
        self.insecureFileSecretStore = insecureFileSecretStore
        self.controlToken = Self.randomToken()
        self.processLauncher = processLauncher
        self.controlRequester = controlRequester
        self.clock = clock
        self.fileSystem = fileSystem
    }

    public func start() throws -> ServiceReadiness {
        lock.lock()
        defer { lock.unlock() }
        if let running, running.process.isRunning, let readiness = running.readiness() {
            return readiness
        }
        guard fileSystem.isExecutableFile(at: executableURL) else {
            throw LauncherError.serviceDidNotBecomeReady
        }

        let collector = ReadinessCollector()
        let exitMonitor = ProcessExitMonitor()
        var arguments = [
            "--port", String(preferredPort),
            "--port-range-start", String(recoveryStart),
            "--port-range-end", String(recoveryEnd),
        ]
        if insecureFileSecretStore {
            arguments.append("--insecure-file-secret-store")
        }
        arguments.append(contentsOf: ["--control-token", controlToken])
        let process = try processLauncher.launch(
            executableURL: executableURL,
            arguments: arguments,
            onOutput: { data in
                collector.append(data)
            },
            onTermination: {
                exitMonitor.recordExit()
            }
        )
        let running = RunningService(process: process)
        self.running = running
        exitMonitor.observeFutureExits { [weak self, weak running] in
            guard let self, let running else {
                return
            }
            self.didExit(running)
        }
        guard let readiness = collector.waitForReadiness(using: clock) else {
            self.running = nil
            process.stopReadingOutput()
            process.terminate()
            throw LauncherError.serviceDidNotBecomeReady
        }
        guard !exitMonitor.hasExited(), process.isRunning else {
            self.running = nil
            process.stopReadingOutput()
            throw LauncherError.serviceDidNotBecomeReady
        }
        running.setReadiness(readiness)
        return readiness
    }

    public func mintBrowserLaunchToken() throws -> String {
        lock.lock()
        let running = self.running
        lock.unlock()
        guard let running,
              let readiness = running.readiness(),
              running.process.isRunning,
              let response = sendControlRequest(for: readiness, path: "/internal/control/launch-token"),
              response.statusCode == 200,
              let payload = try? JSONDecoder().decode(LaunchTokenPayload.self, from: response.data),
              !payload.launchToken.isEmpty
        else {
            throw LauncherError.serviceDidNotBecomeReady
        }
        return payload.launchToken
    }

    public func fetchStatus(completion: @escaping @Sendable (Result<LauncherServiceStatus, Error>) -> Void) {
        lock.lock()
        let running = self.running
        lock.unlock()
        guard let running, running.process.isRunning,
              let readiness = running.readiness(),
              let url = URL(string: "/internal/control/status", relativeTo: readiness.baseURL)?.absoluteURL
        else {
            completion(.failure(LauncherError.serviceDidNotBecomeReady))
            return
        }
        controlRequester.post(url: url, controlToken: controlToken) { data, statusCode in
            guard statusCode == 200, let data,
                  let status = try? JSONDecoder().decode(LauncherServiceStatus.self, from: data)
            else {
                completion(.failure(LauncherError.serviceDidNotBecomeReady))
                return
            }
            completion(.success(status))
        }
    }

    public func stop() {
        lock.lock()
        guard let running else {
            lock.unlock()
            return
        }
        running.markStopRequested()
        lock.unlock()

        requestShutdown(for: running)
        if running.process.isRunning {
            running.process.terminate()
        }
        running.process.waitUntilExit()
        running.process.stopReadingOutput()

        lock.lock()
        if self.running === running {
            self.running = nil
        }
        lock.unlock()
    }

    private func requestShutdown(for running: RunningService) {
        guard let readiness = running.readiness() else {
            return
        }
        _ = sendControlRequest(for: readiness, path: "/internal/control/shutdown")
    }

    private func sendControlRequest(for readiness: ServiceReadiness, path: String) -> ControlResponse? {
        guard var components = URLComponents(url: readiness.baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = path
        guard let url = components.url else {
            return nil
        }

        let completion = DispatchSemaphore(value: 0)
        let result = ControlResponse()
        controlRequester.post(url: url, controlToken: controlToken) { data, statusCode in
            result.complete(data: data, statusCode: statusCode)
            completion.signal()
        }
        guard clock.wait(on: completion, timeout: 2) == .success else {
            return nil
        }
        return result
    }

    private func didExit(_ exited: RunningService) {
        lock.lock()
        let isCurrent = running === exited
        if isCurrent {
            running = nil
        }
        lock.unlock()
        if isCurrent && !exited.stopWasRequested() {
            onUnexpectedExit?()
        }
    }

    private static func randomToken() -> String {
        let bytes = (0 ..< 32).map { _ in UInt8.random(in: .min ... .max) }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

public final class FoundationProcessLauncher: ServiceProcessLaunching {
    public init() {}

    public func launch(
        executableURL: URL,
        arguments: [String],
        onOutput: @escaping @Sendable (Data) -> Void,
        onTermination: @escaping @Sendable () -> Void
    ) throws -> any ServiceProcess {
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        process.terminationHandler = { _ in
            onTermination()
        }
        output.fileHandleForReading.readabilityHandler = { handle in
            onOutput(handle.availableData)
        }
        try process.run()
        return FoundationServiceProcess(process: process, output: output)
    }
}

public final class URLSessionControlRequester: ControlRequesting {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func post(
        url: URL,
        controlToken: String,
        completion: @escaping @Sendable (Data?, Int?) -> Void
    ) {
        var request = URLRequest(url: url, timeoutInterval: 2)
        request.httpMethod = "POST"
        request.setValue(controlToken, forHTTPHeaderField: "X-Cove-Control-Token")
        session.dataTask(with: request) { data, response, _ in
            completion(data, (response as? HTTPURLResponse)?.statusCode)
        }.resume()
    }
}

public struct DispatchServiceClock: ServiceClock {
    public init() {}

    public func wait(on semaphore: DispatchSemaphore, timeout: TimeInterval) -> DispatchTimeoutResult {
        semaphore.wait(timeout: .now() + timeout)
    }
}

public struct FoundationServiceFileSystem: ServiceFileSystem {
    public init() {}

    public func isExecutableFile(at url: URL) -> Bool {
        FileManager.default.isExecutableFile(atPath: url.path)
    }
}

private final class FoundationServiceProcess: ServiceProcess, @unchecked Sendable {
    private let process: Process
    private let output: Pipe

    var isRunning: Bool {
        process.isRunning
    }

    init(process: Process, output: Pipe) {
        self.process = process
        self.output = output
    }

    func terminate() {
        process.terminate()
    }

    func waitUntilExit() {
        process.waitUntilExit()
    }

    func stopReadingOutput() {
        output.fileHandleForReading.readabilityHandler = nil
    }
}

private final class ProcessExitMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var exited = false
    private var onFutureExit: (() -> Void)?

    func recordExit() {
        lock.lock()
        exited = true
        let handler = onFutureExit
        lock.unlock()
        handler?()
    }

    func hasExited() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return exited
    }

    func observeFutureExits(_ handler: @escaping () -> Void) {
        lock.lock()
        onFutureExit = handler
        lock.unlock()
    }
}

private final class RunningService: @unchecked Sendable {
    let process: any ServiceProcess
    private let lock = NSLock()
    private var value: ServiceReadiness?
    private var stopRequested = false

    init(process: any ServiceProcess) {
        self.process = process
    }

    func setReadiness(_ readiness: ServiceReadiness) {
        lock.lock()
        value = readiness
        lock.unlock()
    }

    func readiness() -> ServiceReadiness? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func markStopRequested() {
        lock.lock()
        stopRequested = true
        lock.unlock()
    }

    func stopWasRequested() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopRequested
    }
}

private final class ReadinessCollector: @unchecked Sendable {
    private let lock = NSLock()
    private let signal = DispatchSemaphore(value: 0)
    private var buffer = Data()
    private var result: ServiceReadiness?

    func append(_ data: Data) {
        guard !data.isEmpty else {
            return
        }
        lock.lock()
        defer { lock.unlock() }
        guard result == nil else {
            return
        }
        buffer.append(data)
        guard let newline = buffer.firstIndex(of: 10) else {
            return
        }
        let line = String(decoding: buffer[..<newline], as: UTF8.self)
        guard let readiness = try? ServiceReadiness.parse(line) else {
            return
        }
        result = readiness
        signal.signal()
    }

    func waitForReadiness(using clock: any ServiceClock) -> ServiceReadiness? {
        guard clock.wait(on: signal, timeout: 5) == .success else {
            return nil
        }
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}

private struct LaunchTokenPayload: Decodable {
    let launchToken: String

    enum CodingKeys: String, CodingKey {
        case launchToken = "launch_token"
    }
}

private final class ControlResponse: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var data = Data()
    private(set) var statusCode: Int?

    func complete(data: Data?, statusCode: Int?) {
        lock.lock()
        self.data = data ?? Data()
        self.statusCode = statusCode
        lock.unlock()
    }
}
