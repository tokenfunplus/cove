import Carbon
import Foundation

@MainActor
final class GlobalChatShortcut {
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: @MainActor () -> Void

    init(action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
    }

    func enable() throws {
        guard hotKey == nil else { return }
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var identifier = EventHotKeyID()
                let status = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier
                )
                guard status == noErr, identifier.signature == 0x436F7665, identifier.id == 1 else {
                    return OSStatus(eventNotHandledErr)
                }
                // Carbon delivers application event handlers on the main thread.
                MainActor.assumeIsolated {
                    Unmanaged<GlobalChatShortcut>.fromOpaque(context).takeUnretainedValue().action()
                }
                return noErr
            },
            1, &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &handler
        )
        guard installStatus == noErr else { throw ShortcutError.unavailable }
        let registerStatus = RegisterEventHotKey(
            UInt32(kVK_Space), UInt32(controlKey | optionKey),
            EventHotKeyID(signature: 0x436F7665, id: 1),
            GetApplicationEventTarget(), 0, &hotKey
        )
        guard registerStatus == noErr else {
            disable()
            throw ShortcutError.unavailable
        }
    }

    func disable() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
        hotKey = nil
        handler = nil
    }
}

private enum ShortcutError: Error {
    case unavailable
}
