import AppKit
import WebKit

@MainActor
final class QuickPanelController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private enum LoadState {
        case idle, loading, ready, failed
    }

    private static let bridgeName = "coveQuickPanel"
    private static let compactContentHeight: CGFloat = 148
    private static let maximumAutomaticContentHeight: CGFloat = 620

    private let launchURL: @MainActor () -> URL?
    private let openChat: @MainActor (String?) -> Bool
    private let openProviderSettings: @MainActor () -> Bool
    private let reauthorize: @MainActor (URL) async -> String?
    private var state = LoadState.idle
    private var origin: URL?
    private var pendingLaunch: URL?
    private var navigation: WKNavigation?
    private var loadTimeout: Task<Void, Never>?
    private var reauthorization: Task<Void, Never>?
    private var needsReauthorization = false
    private var hasPositionedWindow = false
    private var focusOnActivation = false
    private var pinned = false
    private var preferredContentHeight = QuickPanelController.compactContentHeight
    private var automaticallySizes = true
    private var liveResizeStartSize: NSSize?

    private lazy var pinButton = NSButton(image: pinImage, target: self, action: #selector(togglePin))
    private lazy var statusLabel = NSTextField(labelWithString: "Opening Quick Panel…")
    private lazy var retryButton = NSButton(title: "Try Again", target: self, action: #selector(retry))
    private lazy var webView = makeWebView()
    private lazy var statusView = makeStatusView()
    private lazy var panel = makePanel()

    init(
        launchURL: @escaping @MainActor () -> URL?,
        openChat: @escaping @MainActor (String?) -> Bool,
        openProviderSettings: @escaping @MainActor () -> Bool,
        reauthorize: @escaping @MainActor (URL) async -> String?
    ) {
        self.launchURL = launchURL
        self.openChat = openChat
        self.openProviderSettings = openProviderSettings
        self.reauthorize = reauthorize
    }

    func prepare() {
        guard state == .idle else { return }
        startLoad()
    }

    func show() {
        if !hasPositionedWindow {
            let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
            if let area = screen?.visibleFrame {
                let top = area.maxY - min(160, area.height / 4)
                panel.setFrameOrigin(NSPoint(x: area.midX - panel.frame.width / 2, y: top - panel.frame.height))
            }
            hasPositionedWindow = true
        }
        resizeToPreferredHeight()
        focusOnActivation = true
        panel.makeKeyAndOrderFront(nil)
        switch state {
        case .idle, .failed:
            startLoad()
        case .ready:
            focusComposer()
            if needsReauthorization { refreshSession() }
        case .loading:
            break
        }
    }

    func toggle() {
        if hasPositionedWindow && panel.isKeyWindow {
            hide()
        } else {
            show()
        }
    }

    func serviceDidChange(baseURL: URL?) {
        guard let origin else { return }
        guard let baseURL = baseURL.flatMap(Self.loopbackOrigin) else {
            reauthorization?.cancel()
            reauthorization = nil
            if state == .ready {
                needsReauthorization = true
                dispatchSession(nil)
            }
            return
        }

        if baseURL != origin {
            let isVisible = hasPositionedWindow && panel.isVisible
            resetPage()
            if isVisible { startLoad() }
        } else if state == .ready && needsReauthorization && hasPositionedWindow && panel.isVisible {
            refreshSession()
        }
    }

    func windowDidBecomeKey(_ notification: Notification) { focusComposer() }

    func windowWillStartLiveResize(_ notification: Notification) {
        liveResizeStartSize = panel.frame.size
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if let startSize = liveResizeStartSize, startSize != panel.frame.size {
            automaticallySizes = false
        }
        liveResizeStartSize = nil
        resizeToPreferredHeight()
    }

    func windowShouldZoom(_ window: NSWindow, toFrame newFrame: NSRect) -> Bool {
        automaticallySizes = false
        return true
    }

    func windowDidChangeScreen(_ notification: Notification) {
        if let window = notification.object as? NSWindow, window.isVisible, NSEvent.pressedMouseButtons == 0 {
            resizeToPreferredHeight()
        }
    }

    func windowDidEndSheet(_ notification: Notification) { resizeToPreferredHeight() }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hide()
        return false
    }

    private func hide() {
        focusOnActivation = false
        panel.orderOut(nil)
    }

    private func resizeToPreferredHeight() {
        guard automaticallySizes, liveResizeStartSize == nil, panel.attachedSheet == nil else { return }

        let current = panel.frame
        var content = panel.contentRect(forFrameRect: current)
        content.size.height = preferredContentHeight
        var height = panel.frameRect(forContentRect: content).height
        var top = current.maxY
        if let area = panel.screen?.visibleFrame {
            content.size.height = Self.compactContentHeight
            let minimumHeight = panel.frameRect(forContentRect: content).height
            top = min(max(top, area.minY + minimumHeight), area.maxY)
            height = min(height, top - area.minY)
        }

        // Extend the panel down from its title bar so its controls stay in place.
        let next = NSRect(x: current.minX, y: top - height, width: current.width, height: height)
        if next != current { panel.setFrame(next, display: panel.isVisible) }
    }

    private func makePanel() -> QuickPanelWindow {
        let panel = QuickPanelWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: Self.compactContentHeight),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Cove Quick Panel"
        panel.contentMinSize = NSSize(width: 400, height: Self.compactContentHeight)
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.onDismiss = { [weak self] in self?.hide() }

        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .right
        pinButton.bezelStyle = .accessoryBarAction
        updatePinButton()
        let accessoryView = NSStackView(views: [pinButton])
        accessoryView.edgeInsets = NSEdgeInsets(top: 0, left: 4, bottom: 0, right: 10)
        accessoryView.frame.size = accessoryView.fittingSize
        accessory.view = accessoryView
        panel.addTitlebarAccessoryViewController(accessory)

        let content = NSView()
        for view in [webView, statusView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
                view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
                view.topAnchor.constraint(equalTo: content.topAnchor),
                view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            ])
        }
        panel.contentView = content
        return panel
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(QuickPanelBridge(controller: self), name: Self.bridgeName)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        return view
    }

    private func makeStatusView() -> NSView {
        statusLabel.textColor = .secondaryLabelColor
        retryButton.bezelStyle = .rounded
        let stack = NSStackView(views: [statusLabel, retryButton])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let view = NSView()
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        return view
    }

    private var pinImage: NSImage {
        NSImage(systemSymbolName: pinned ? "pin.fill" : "pin", accessibilityDescription: nil)!
    }

    private func updatePinButton() {
        let label = pinned ? "Unpin Quick Panel" : "Pin Quick Panel"
        pinButton.image = pinImage
        pinButton.toolTip = label
        pinButton.setAccessibilityLabel(label)
    }

    @objc private func togglePin() {
        pinned.toggle()
        panel.level = pinned ? .floating : .normal
        updatePinButton()
    }

    @objc private func retry() { startLoad() }

    private func display(_ nextState: LoadState) {
        state = nextState
        webView.isHidden = nextState != .ready
        statusView.isHidden = nextState == .ready
        statusLabel.stringValue = nextState == .failed ? "Quick Panel is unavailable." : "Opening Quick Panel…"
        retryButton.isHidden = nextState != .failed
        panel.webHandlesEscape = nextState == .ready
    }

    private func startLoad() {
        display(.loading)
        Task { [weak self] in
            guard let self, state == .loading else { return }
            guard let url = launchURL(), let origin = Self.loopbackOrigin(url), url.path == "/launch" else {
                failLoad()
                return
            }
            self.origin = origin
            pendingLaunch = url
            navigation = webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
            loadTimeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled, let self, state == .loading else { return }
                failLoad()
            }
        }
    }

    private func failLoad() {
        resetPage()
        display(.failed)
    }

    private func resetPage() {
        loadTimeout?.cancel()
        loadTimeout = nil
        reauthorization?.cancel()
        reauthorization = nil
        needsReauthorization = false
        origin = nil
        pendingLaunch = nil
        navigation = nil
        preferredContentHeight = Self.compactContentHeight
        webView.stopLoading()
        display(.idle)
        if panel.isVisible { resizeToPreferredHeight() }
    }

    private func focusComposer() {
        guard focusOnActivation, state == .ready, panel.isKeyWindow else { return }
        focusOnActivation = false
        panel.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.dispatchEvent(new Event('cove-quick-panel-focus'))")
    }

    private func refreshSession() {
        guard state == .ready, let origin, reauthorization == nil else { return }
        needsReauthorization = true
        reauthorization = Task { [weak self] in
            guard let self else { return }
            let token = await reauthorize(origin)
            guard !Task.isCancelled else { return }
            reauthorization = nil
            needsReauthorization = token == nil
            dispatchSession(token)
        }
    }

    private func dispatchSession(_ token: String?) {
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('cove-quick-panel-session', { detail: { token } }));",
            arguments: ["token": token.map { $0 as Any } ?? NSNull()],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.name == Self.bridgeName, message.webView === webView, isQuickPanelFrame(message.frameInfo),
              let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }

        switch action {
        case "ready" where state == .loading:
            loadTimeout?.cancel()
            loadTimeout = nil
            navigation = nil
            display(.ready)
            if panel.isVisible { resizeToPreferredHeight() }
            focusComposer()
        case "resize" where state == .loading || state == .ready:
            guard let height = payload["height"] as? CGFloat, height.isFinite, height > 0 else { return }
            preferredContentHeight = min(max(ceil(height), Self.compactContentHeight), Self.maximumAutomaticContentHeight)
            if panel.isVisible && state == .ready { resizeToPreferredHeight() }
        case "escape" where panel.isKeyWindow && panel.attachedSheet == nil:
            hide()
        case "open-chat" where state == .ready:
            if let value = payload["conversationId"] {
                guard let id = value as? String, UUID(uuidString: id) != nil else { return }
                if openChat(id) { hide() }
            } else if openChat(nil) {
                hide()
            }
        case "open-provider-settings" where state == .ready:
            if openProviderSettings() { hide() }
        case "reauthorize":
            refreshSession()
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.targetFrame else {
            openExternalLink(action)
            decisionHandler(.cancel)
            return
        }
        // Cove's document policy controls subframes used for private inference verification.
        guard target.isMainFrame else {
            decisionHandler(.allow)
            return
        }
        if let url = action.request.url {
            if url == pendingLaunch {
                pendingLaunch = nil
                decisionHandler(.allow)
                return
            }
            if isQuickPanelPage(url) {
                decisionHandler(.allow)
                return
            }
        }
        openExternalLink(action)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame else {
            decisionHandler(.allow)
            return
        }
        if let response = response.response as? HTTPURLResponse, let url = response.url,
           (200..<300).contains(response.statusCode), isQuickPanelPage(url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if state == .loading { failLoad() }
        }
    }

    private func openExternalLink(_ action: WKNavigationAction) {
        guard action.navigationType == .linkActivated, isQuickPanelFrame(action.sourceFrame),
              let url = action.request.url, let scheme = url.scheme, ["http", "https"].contains(scheme),
              url.host != nil, url.user == nil, url.password == nil, Self.loopbackOrigin(url) != origin else { return }
        NSWorkspace.shared.open(url)
    }

    private static func loopbackOrigin(_ url: URL) -> URL? {
        guard url.scheme == "http", url.host == "127.0.0.1", let port = url.port,
              (1...65535).contains(port), url.user == nil, url.password == nil else { return nil }
        return URL(string: "http://127.0.0.1:\(port)")
    }

    private func isQuickPanelPage(_ url: URL) -> Bool {
        guard let origin, Self.loopbackOrigin(url) == origin, url.path == "/" else { return false }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "surface", value: "quick-panel")]
    }

    private func isQuickPanelFrame(_ frame: WKFrameInfo) -> Bool {
        let securityOrigin = frame.securityOrigin
        return frame.isMainFrame && securityOrigin.protocol == "http" && securityOrigin.host == "127.0.0.1"
            && securityOrigin.port == origin?.port && frame.request.url.map(isQuickPanelPage) == true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if let navigation, navigation === self.navigation { failLoad() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if let navigation, navigation === self.navigation { failLoad() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failLoad() }

    func webView(
        _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard isQuickPanelFrame(frame), panel.isKeyWindow, panel.attachedSheet == nil else {
            completionHandler(nil)
            return
        }
        let picker = NSOpenPanel()
        picker.canChooseDirectories = false
        picker.allowsMultipleSelection = parameters.allowsMultipleSelection
        picker.beginSheetModal(for: panel) { response in
            completionHandler(response == .OK ? picker.urls : nil)
        }
    }
}

private final class QuickPanelWindow: NSPanel {
    var onDismiss: (() -> Void)?
    var webHandlesEscape = false

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if super.performKeyEquivalent(with: event) { return true }
        guard event.modifierFlags.intersection([.command, .option, .control, .shift]) == .command else { return false }
        // The menu-bar Launcher has no visible Edit menu while the panel is key.
        let action: Selector
        switch event.charactersIgnoringModifiers?.lowercased() {
        case "a": action = #selector(NSText.selectAll(_:))
        case "c": action = #selector(NSText.copy(_:))
        case "v": action = #selector(NSText.paste(_:))
        case "x": action = #selector(NSText.cut(_:))
        default: return false
        }
        return firstResponder?.tryToPerform(action, with: self) == true
    }

    override func sendEvent(_ event: NSEvent) {
        if !webHandlesEscape && event.type == .keyDown && event.keyCode == 53 {
            onDismiss?()
        } else {
            super.sendEvent(event)
        }
    }

    override func cancelOperation(_ sender: Any?) { onDismiss?() }
}

@MainActor
private final class QuickPanelBridge: NSObject, WKScriptMessageHandler {
    private weak var controller: QuickPanelController?

    init(controller: QuickPanelController) { self.controller = controller }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        controller?.receive(message)
    }
}
