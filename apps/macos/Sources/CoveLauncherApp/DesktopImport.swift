import Foundation

struct DesktopImport {
    private static let maximumTextBytes = 60_000

    let id = UUID()
    let text: String

    init(text: String) throws {
        guard text.utf8.count <= Self.maximumTextBytes else { throw DesktopIntakeError.textTooLong }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DesktopIntakeError.emptySelection
        }
        self.text = text
    }

    var bridgeValue: [String: String] {
        ["id": id.uuidString.lowercased(), "text": text]
    }
}

enum DesktopIntakeError: LocalizedError {
    case emptySelection, textTooLong, queueFull, unavailable

    var errorDescription: String? {
        switch self {
        case .emptySelection: return "Select some text to ask Cove."
        case .textTooLong: return "The imported text is too long. Choose a shorter selection."
        case .queueFull: return "Finish reviewing the pending imports in Cove and try again."
        case .unavailable: return "Open Cove and try again."
        }
    }
}
