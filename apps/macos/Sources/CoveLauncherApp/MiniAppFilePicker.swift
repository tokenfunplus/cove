import AppKit
import CoveLauncher
import UniformTypeIdentifiers

@MainActor
func pickMiniAppText(_ id: UUID, service: BundledServiceManager) async {
    struct Claim: Decodable { let instance: String }
    struct Reply: Encodable { let state: String; var name: String?; var text: String? }
    guard let data = try? await service.miniAppFileRequest(id),
          let claim = try? JSONDecoder().decode(Claim.self, from: data) else { return }
    let panel = NSOpenPanel()
    panel.message = "Choose a UTF-8 text file for " + claim.instance
    panel.allowedContentTypes = [.plainText]
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    NSApp.activate(ignoringOtherApps: true)
    var reply = Reply(state: "cancelled")
    if await panel.begin() == .OK, let url = panel.url {
        reply = Reply(state: "failed")
        if (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
           let handle = try? FileHandle(forReadingFrom: url) {
            defer { try? handle.close() }
            if let bytes = try? handle.read(upToCount: 60001), bytes.count <= 60000,
               let text = String(data: bytes, encoding: .utf8) {
                reply = Reply(state: "completed", name: url.lastPathComponent, text: text)
            }
        }
    }
    guard let body = try? JSONEncoder().encode(reply) else { return }
    _ = try? await service.miniAppFileRequest(id, reply: body)
}
