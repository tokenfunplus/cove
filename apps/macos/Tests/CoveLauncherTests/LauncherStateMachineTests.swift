import XCTest
@testable import CoveLauncher

@MainActor
final class LauncherStateMachineTests: XCTestCase {
    func testLauncherStartupStartsTheLocalServiceAndOpensChat() throws {
        let readiness = try ServiceReadiness.parse(
            #"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#
        )
        let service = FakeService(readiness: readiness)
        let browser = RecordingBrowser()
        let launcher = LauncherStateMachine(service: service, browser: browser)

        launcher.startIfNeededAndOpenChat()
        launcher.startIfNeededAndOpenChat()

        XCTAssertEqual(service.startCount, 1)
        XCTAssertEqual(service.mintLaunchTokenCount, 1)
        XCTAssertEqual(browser.openedURLs, [URL(string: "http://127.0.0.1:47123/launch?token=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")!])
        XCTAssertEqual(launcher.state, .ready(readiness))
    }

    func testLauncherControlsBundledServiceAndOpensOneTimeAuthorizedChat() throws {
        let readiness = try ServiceReadiness.parse(
            #"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#
        )
        let service = FakeService(readiness: readiness)
        let browser = RecordingBrowser()
        let launcher = LauncherStateMachine(service: service, browser: browser)

        try launcher.start()
        launcher.openChat()

        XCTAssertEqual(service.startCount, 1)
        XCTAssertEqual(service.mintLaunchTokenCount, 1)
        XCTAssertEqual(browser.openedURLs, [URL(string: "http://127.0.0.1:47123/launch?token=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")!])
        XCTAssertEqual(launcher.state, .ready(readiness))

        try launcher.restart()
        XCTAssertEqual(service.startCount, 2)
        XCTAssertEqual(service.stopCount, 1)

        launcher.serviceExited()
        XCTAssertEqual(launcher.state, .failed("The Local Service stopped unexpectedly."))

        launcher.quit()
        XCTAssertEqual(service.stopCount, 2)
        XCTAssertEqual(launcher.state, .stopped)
    }

    func testBundledServiceManagerUsesInjectedProcessAndControlDependencies() throws {
        let readiness = try ServiceReadiness.parse(
            #"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#
        )
        let process = StubProcess()
        let processLauncher = StubProcessLauncher(process: process)
        let control = StubControlRequester()
        let manager = BundledServiceManager(
            executableURL: URL(fileURLWithPath: "/Applications/Cove.app/Contents/MacOS/cove-local-service"),
            processLauncher: processLauncher,
            controlRequester: control,
            clock: StubClock(),
            fileSystem: StubFileSystem()
        )

        XCTAssertEqual(try manager.start(), readiness)
        XCTAssertEqual(processLauncher.arguments, [
            "--port", "19421",
            "--port-range-start", "19421",
            "--port-range-end", "19521",
            "--control-token", processLauncher.controlToken!,
        ])
        XCTAssertEqual(
            try manager.mintBrowserLaunchToken(),
            "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        )

        manager.stop()
        XCTAssertEqual(control.paths, ["/internal/control/launch-token", "/internal/control/shutdown"])
        XCTAssertTrue(process.didTerminate)
        XCTAssertTrue(process.didWaitForExit)
        XCTAssertTrue(process.didStopReadingOutput)
    }

    func testBundledServiceManagerRejectsAServiceThatExitsAfterReadiness() throws {
        let process = StubProcess()
        let manager = BundledServiceManager(
            executableURL: URL(fileURLWithPath: "/Applications/Cove.app/Contents/MacOS/cove-local-service"),
            processLauncher: StubProcessLauncher(process: process, exitsAfterReadiness: true),
            controlRequester: StubControlRequester(),
            clock: StubClock(),
            fileSystem: StubFileSystem()
        )

        XCTAssertThrowsError(try manager.start())
        XCTAssertFalse(process.isRunning)
        XCTAssertTrue(process.didStopReadingOutput)
    }

    func testBundledServiceManagerUsesTheTicketSevenPortRangeByDefault() throws {
        let readiness = try ServiceReadiness.parse(
            #"{"url":"http://127.0.0.1:19421","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#
        )
        let processLauncher = StubProcessLauncher(process: StubProcess(), readiness: readiness)
        let manager = BundledServiceManager(
            executableURL: URL(fileURLWithPath: "/Applications/Cove.app/Contents/Resources/cove-local-service"),
            processLauncher: processLauncher,
            controlRequester: StubControlRequester(),
            clock: StubClock(),
            fileSystem: StubFileSystem()
        )

        _ = try manager.start()

        XCTAssertEqual(processLauncher.arguments, [
            "--port", "19421",
            "--port-range-start", "19421",
            "--port-range-end", "19521",
            "--control-token", processLauncher.controlToken!,
        ])
    }

    func testBundledServiceManagerCanEnableTheInsecureFileSecretStoreForTestPackages() throws {
        let processLauncher = StubProcessLauncher(process: StubProcess())
        let manager = BundledServiceManager(
            executableURL: URL(fileURLWithPath: "/Applications/Cove.app/Contents/Resources/cove-local-service"),
            insecureFileSecretStore: true,
            processLauncher: processLauncher,
            controlRequester: StubControlRequester(),
            clock: StubClock(),
            fileSystem: StubFileSystem()
        )

        _ = try manager.start()

        XCTAssertEqual(processLauncher.arguments, [
            "--port", "19421",
            "--port-range-start", "19421",
            "--port-range-end", "19521",
            "--insecure-file-secret-store",
            "--control-token", processLauncher.controlToken!,
        ])
    }

    func testUpdateManifestRequiresHTTPSAndCarriesOnlyDownloadMetadata() throws {
        let manifest = try UpdateManifest.parse(Data(#"{"version":"1.2.0","download_url":"https://downloads.example.test/Cove.zip"}"#.utf8))

        XCTAssertEqual(manifest.version, "1.2.0")
        XCTAssertEqual(manifest.downloadURL, URL(string: "https://downloads.example.test/Cove.zip"))
        XCTAssertThrowsError(try UpdateManifest.parse(Data(#"{"version":"1.2.0","download_url":"http://downloads.example.test/Cove.zip"}"#.utf8)))
        XCTAssertThrowsError(try UpdateManifest.parse(Data(#"{"version":"release","download_url":"https://downloads.example.test/Cove.zip"}"#.utf8)))
    }

    func testUpdateCheckerReportsAnAvailableVersionWithoutDownloadingIt() throws {
        let requester = StubUpdateRequester(data: Data(#"{"version":"1.2.0","download_url":"https://downloads.example.test/Cove.zip"}"#.utf8), statusCode: 200)
        let checker = UpdateChecker(
            currentVersion: "1.1.0",
            manifestURL: URL(string: "https://updates.example.test/cove.json")!,
            requester: requester
        )
        let expectation = expectation(description: "update check completes")
        let result = ResultBox<Result<AppUpdate?, Error>>()

        checker.check { checked in
            result.value = checked
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1)
        XCTAssertEqual(requester.requestedURLs, [URL(string: "https://updates.example.test/cove.json")!])
        guard case let .success(update?) = result.value else {
            return XCTFail("update check result = \(String(describing: result.value)), want an available update")
        }
        XCTAssertEqual(update.version, "1.2.0")
        XCTAssertEqual(update.downloadURL, URL(string: "https://downloads.example.test/Cove.zip"))
        XCTAssertEqual(requester.downloadCalls, 0)
    }

    func testUpdateCheckerComparesNumericVersionComponents() throws {
        let requester = StubUpdateRequester(data: Data(#"{"version":"1.10.0","download_url":"https://downloads.example.test/Cove.zip"}"#.utf8), statusCode: 200)
        let checker = UpdateChecker(
            currentVersion: "1.9.0",
            manifestURL: URL(string: "https://updates.example.test/cove.json")!,
            requester: requester
        )
        let expectation = expectation(description: "numeric version check completes")
        let result = ResultBox<Result<AppUpdate?, Error>>()

        checker.check { checked in
            result.value = checked
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1)
        guard case let .success(update?) = result.value else {
            return XCTFail("numeric version check result = \(String(describing: result.value))")
        }
        XCTAssertEqual(update.version, "1.10.0")
    }
}

private final class FakeService: ServiceManaging {
    let readiness: ServiceReadiness
    var startCount = 0
    var stopCount = 0
    var mintLaunchTokenCount = 0

    init(readiness: ServiceReadiness) {
        self.readiness = readiness
    }

    func start() throws -> ServiceReadiness {
        startCount += 1
        return readiness
    }

    func stop() {
        stopCount += 1
    }

    func mintBrowserLaunchToken() throws -> String {
        mintLaunchTokenCount += 1
        return "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    }
}

private final class RecordingBrowser: BrowserOpening {
    var openedURLs: [URL] = []

    func open(_ url: URL) {
        openedURLs.append(url)
    }
}

private final class StubProcess: ServiceProcess {
    var isRunning = true
    var didTerminate = false
    var didWaitForExit = false
    var didStopReadingOutput = false

    func terminate() {
        didTerminate = true
        isRunning = false
    }

    func waitUntilExit() {
        didWaitForExit = true
    }

    func stopReadingOutput() {
        didStopReadingOutput = true
    }
}

private final class StubProcessLauncher: ServiceProcessLaunching {
    let process: StubProcess
    let exitsAfterReadiness: Bool
    let readiness: ServiceReadiness
    var arguments: [String] = []
    var controlToken: String?

    init(process: StubProcess, exitsAfterReadiness: Bool = false, readiness: ServiceReadiness? = nil) {
        self.process = process
        self.exitsAfterReadiness = exitsAfterReadiness
        self.readiness = readiness ?? (try! ServiceReadiness.parse(
            #"{"url":"http://127.0.0.1:47123","launch_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#
        ))
    }

    func launch(
        executableURL: URL,
        arguments: [String],
        onOutput: @escaping @Sendable (Data) -> Void,
        onTermination: @escaping @Sendable () -> Void
    ) throws -> any ServiceProcess {
        self.arguments = arguments
        controlToken = arguments.last
        let readinessLine = "{\"url\":\"\(readiness.baseURL.absoluteString)\",\"launch_token\":\"\(readiness.launchToken)\"}"
        onOutput(Data((readinessLine + "\n").utf8))
        if exitsAfterReadiness {
            process.isRunning = false
            onTermination()
        }
        return process
    }
}

private final class StubControlRequester: ControlRequesting {
    var paths: [String] = []

    func post(url: URL, controlToken: String, completion: @escaping @Sendable (Data?, Int?) -> Void) {
        paths.append(url.path)
        if url.path == "/internal/control/launch-token" {
            completion(Data(#"{"launch_token":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}"#.utf8), 200)
            return
        }
        completion(Data(), 202)
    }
}

private struct StubClock: ServiceClock {
    func wait(on semaphore: DispatchSemaphore, timeout: TimeInterval) -> DispatchTimeoutResult {
        semaphore.wait(timeout: .now() + timeout)
    }
}

private struct StubFileSystem: ServiceFileSystem {
    func isExecutableFile(at _: URL) -> Bool {
        true
    }
}

private final class StubUpdateRequester: UpdateRequesting {
    let data: Data?
    let statusCode: Int?
    var requestedURLs: [URL] = []
    var downloadCalls = 0

    init(data: Data?, statusCode: Int?) {
        self.data = data
        self.statusCode = statusCode
    }

    func get(url: URL, completion: @escaping @Sendable (Data?, Int?) -> Void) {
        requestedURLs.append(url)
        completion(data, statusCode)
    }
}

private final class ResultBox<Value>: @unchecked Sendable {
    var value: Value?
}
