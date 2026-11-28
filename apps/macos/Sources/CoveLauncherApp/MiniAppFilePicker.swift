import AppKit
import CoveLauncher
import UniformTypeIdentifiers

struct MiniAppSelectionTarget: Codable, Equatable {
    let instance, name, view, action, title, field: String
    let revision: Int
}

@MainActor
func miniAppSelectionMenu(_ targets: [MiniAppSelectionTarget]) -> NSPopUpButton {
    let list = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 380, height: 28))
    for target in targets {
        let item = NSMenuItem(title: target.name + " · " + target.title + " · " + target.field, action: nil, keyEquivalent: "")
        item.representedObject = target
        list.menu?.addItem(item)
    }
    list.selectItem(at: 0)
    return list
}

@MainActor
func pickMiniAppText(_ id: UUID, service: BundledServiceManager) async {
    struct Claim: Decodable { let instance: String }
    struct Reply: Encodable { let state: String; var name: String?; var text: String? }
    guard let data = try? await service.miniAppFileRequest(id),
          let claim = try? JSONDecoder().decode(Claim.self, from: data) else { miniAppNotice("The file request expired. Open the file picker again from the app."); return }
    let panel = NSOpenPanel()
    panel.message = "Choose a UTF-8 text file for " + claim.instance
    panel.allowedContentTypes = [.plainText, .sourceCode] +
        ["md", "json", "jsonl", "yaml", "yml", "html", "xml", "toml", "csv", "tsv"]
            .compactMap { UTType(filenameExtension: $0) }
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    NSApp.activate(ignoringOtherApps: true)
    // Keep the lease while the system dialog is open. A crashed Launcher stops renewing.
    let lease = Task {
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 30_000_000_000)
                try await service.renewMiniAppPicker(id)
            } catch {
                if Task.isCancelled { return }
                // A brief IPC interruption leaves the current lease valid for two minutes.
            }
        }
    }
    defer { lease.cancel() }
    var reply = Reply(state: "cancelled")
    if await panel.begin() == .OK, let url = panel.url {
        reply = Reply(state: "failed")
        let selected: (String, String)? = await Task.detached(priority: .userInitiated) {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
                  let handle = try? FileHandle(forReadingFrom: url) else { return nil }
            defer { try? handle.close() }
            guard let bytes = try? handle.read(upToCount: 60001), bytes.count <= 60000,
                  let text = String(data: bytes, encoding: .utf8) else { return nil }
            return (url.lastPathComponent, text)
        }.value
        if let selected { reply = Reply(state: "completed", name: selected.0, text: selected.1) }

    }
    guard let body = try? JSONEncoder().encode(reply) else { return }
    do { _ = try await service.miniAppFileRequest(id, reply: body) }
    catch { miniAppNotice("Cove could not deliver the selection. Reopen the file picker from the app.") }
}

@MainActor
func miniAppNotice(_ message: String) {
    let alert = NSAlert()
    alert.messageText = message
    NSApp.activate(ignoringOtherApps: true)
    alert.runModal()
}

@MainActor
func chooseMiniAppForSelection(_ text: String, launcher: LauncherStateMachine, service: BundledServiceManager) async -> UUID? {
    struct Selection: Encodable { let target: MiniAppSelectionTarget; let text: String }
    do {
        try launcher.start()
        let data = try await service.miniAppSelectionTargets()
        let targets = try JSONDecoder().decode([MiniAppSelectionTarget].self, from: data)
        guard !targets.isEmpty else {
            miniAppNotice("Enable selection access and a text action in a Mini App's settings first.")
            return nil
        }
        let alert = NSAlert()
        alert.messageText = "Send selected text to a Mini App"
        let list = miniAppSelectionMenu(targets)
        alert.accessoryView = list
        alert.addButton(withTitle: "Send selection")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        guard let target = list.selectedItem?.representedObject as? MiniAppSelectionTarget else { return nil }
        let receipt = try await service.stageMiniAppSelection(JSONEncoder().encode(Selection(target: target, text: text)))
        guard let object = try JSONSerialization.jsonObject(with: receipt) as? [String:String], let raw = object["id"], let selection = UUID(uuidString: raw) else { return nil }
        if let id = UUID(uuidString: target.instance),
           !launcher.openMiniApp(.open(id, target.view), selection: selection) {
            miniAppNotice("Cove could not open the selected app. Reopen Cove and send the selection again.")
        }
        return selection
    } catch {
        miniAppNotice("Cove could not send this selection. Check the app's permissions and try again.")
        return nil
    }
}
