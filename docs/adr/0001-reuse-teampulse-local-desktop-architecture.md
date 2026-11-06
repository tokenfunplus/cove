# Reuse the TeamPulse local desktop architecture

Secure Chat uses the TeamPulse architecture as a reference: a SwiftUI menu-bar Launcher starts and controls a bundled loopback Local Service, which serves embedded React assets and APIs to the user's browser. Cove owns its `CoveLauncher.LauncherStateMachine` implementation and tests; it has no source dependency on TeamPulse. This preserves the reference architecture's lifecycle and local-session security model while keeping the chat product local-first.
