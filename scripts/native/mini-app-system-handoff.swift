import AppKit
import Foundation
@testable import CoveLauncher

// Launch the packaged executable with an explicitly targeted macOS URL event.
// Give the copy its own ID and remove handler declarations before Launch Services
// sees it. Its acceptance browser captures the proof within the test directory.
@MainActor
func verifySystemHandoff(bundle: URL, data: URL, instance: String) async throws {
    let fm = FileManager.default
    let id = "io.cove.acceptance." + UUID().uuidString.lowercased()
    let scratch = fm.temporaryDirectory.appendingPathComponent(id)
    try fm.createDirectory(at: scratch, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: scratch) }
    let copy = scratch.appendingPathComponent("LauncherAcceptance.app")
    guard bundle.pathExtension == "app" else {
        fputs("OS handoff requires the Local Service inside a built Cove.app.\n", stderr)
        throw FixtureFailure.mismatch
    }
    try fm.copyItem(at:bundle,to:copy)
    let plist = copy.appendingPathComponent("Contents/Info.plist")
    let manifest = try PropertyListSerialization.propertyList(from: Data(contentsOf:plist), format:nil)
    guard var config = manifest as? [String:Any],
          let urlTypes = config["CFBundleURLTypes"] as? [[String:Any]],
          urlTypes.contains(where:{ ($0["CFBundleURLSchemes"] as? [String])?.contains("cove") == true })
    else { throw FixtureFailure.mismatch }
    config["CFBundleIdentifier"] = id
    config.removeValue(forKey:"NSServices")
    config.removeValue(forKey:"CFBundleURLTypes")
    try PropertyListSerialization.data(fromPropertyList:config,format:.xml,options:0).write(to:plist)
    func run(_ binary:String, _ arguments:[String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath:binary)
        p.arguments = arguments
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        p.waitUntilExit()
        try expect(p.terminationStatus == 0)
    }
    try run("/usr/bin/codesign",["--force","--sign","-",copy.path])
    let capture = scratch.appendingPathComponent("browser")
    _ = fm.createFile(atPath:capture.path,contents:nil,attributes:[.posixPermissions:0o600])
    let link = URL(string:"cove://open/" + instance + "/questions")!
    let originalHandler = NSWorkspace.shared.urlForApplication(toOpen:link)
    defer {
        for app in NSRunningApplication.runningApplications(withBundleIdentifier:id) {
            _ = app.terminate()
        }
        // Older packaged Launchers may exit before reaping their service.
        // Only signal an executable whose resolved path belongs to this copy.
        let target = copy.appendingPathComponent("Contents/Resources/cove-local-service").resolvingSymlinksInPath().path
        var pids = [pid_t](repeating:0, count:Int(proc_listallpids(nil,0))+128)
        let count = pids.withUnsafeMutableBytes { proc_listallpids($0.baseAddress,Int32($0.count)) }
        for pid in pids.prefix(max(0,Int(count))) where pid > 1 {
            var path = [CChar](repeating:0,count:4096)
            if proc_pidpath(pid,&path,UInt32(path.count)) > 0 && String(cString:path) == target { _ = kill(pid,SIGTERM) }
        }
    }
    try run("/usr/bin/open",["-n","-g","-j","-a",copy.path,"--stdout",capture.path,"--stderr","/dev/null",
        "--env","COVE_PACKAGE_ACCEPTANCE_TEST=1","--env","COVE_DATA_DIR="+data.path,
        "--env","COVE_INSECURE_FILE_SECRET_STORE=1","--env","COVE_APP_CATALOG_URL=","-u",link.absoluteString])
    var landing: URL?
    for _ in 0..<160 {
        let lines = (try? String(contentsOf:capture,encoding:.utf8))?.split(separator:"\n") ?? []
        for line in lines where line.hasPrefix("COVE_PACKAGE_ACCEPTANCE_BROWSER_URL=") {
            let raw = line.dropFirst("COVE_PACKAGE_ACCEPTANCE_BROWSER_URL=".count)
            if let url = URL(string:String(raw)), url.host == "127.0.0.1",
               URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.contains(URLQueryItem(name:"instance",value:instance)) == true {
                landing = url
            }
        }
        if landing != nil {break}
        try await Task.sleep(nanoseconds:100_000_000)
    }
    guard let landing, let origin = URLComponents(url:landing,resolvingAgainstBaseURL:false),
          let port = origin.port, let local = URL(string:"http://127.0.0.1:"+String(port)) else {
        fputs("The cold Launcher did not receive the targeted URL event.\n",stderr)
        throw FixtureFailure.mismatch
    }
    let (_,response) = try await URLSession.shared.data(for: URLRequest(url:landing),delegate:LaunchRedirectObserver())
    guard let http = response as? HTTPURLResponse, http.statusCode == 303,
          let location = http.value(forHTTPHeaderField:"Location"),
          location.hasPrefix("/apps/"+instance+"/questions#cove-session="),
          let session = location.components(separatedBy:"#cove-session=").last else {throw FixtureFailure.mismatch}
    let client = LocalClient(origin:local,token:session)
    let restored = try await client.call("/api/mini-apps/instances/"+instance)
    try expect((restored["instance"] as? [String:Any])?["name"] as? String == "Picker fixture")
    try expect(NSWorkspace.shared.urlForApplication(toOpen:link) == originalHandler)
    for app in NSRunningApplication.runningApplications(withBundleIdentifier:id) {
        try expect(app.terminate())
        for _ in 0..<50 where !app.isTerminated {try await Task.sleep(nanoseconds:100_000_000)}
        try expect(app.isTerminated)
    }
    print("macOS cold-start URL event restored the saved local instance; the system URL handler stayed unchanged.")
}
