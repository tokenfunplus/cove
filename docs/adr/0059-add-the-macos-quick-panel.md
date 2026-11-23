# Add the macOS Quick Panel

Short tasks should take one shortcut to a focused composer when the Local Service is ready. The Launcher opens a compact Chat Surface in an AppKit `NSPanel`. Control-Option-Space uses the existing optional global registration and now opens the Quick Panel. This supersedes the shortcut destination in [ADR-0043](0043-streamline-launcher-menu-and-onboarding.md). The Launcher menu also opens the panel, while Open Chat opens the full browser workspace. [Apple NSPanel documentation](https://developer.apple.com/documentation/appkit/nspanel)

The Launcher owns focusing, hiding, and pinning the panel. Hiding it keeps the compact Chat Surface mounted so unsent text and pending attachments can stay in memory across invocations. The compact composer uses the same file validation and attachment previews as the full workspace. See [draft state](0029-keep-history-search-and-draft-navigation-local.md) and [source attachment limits](0025-snapshot-local-source-documents-for-file-chat.md).

When the shortcut is enabled, the Launcher prepares the panel as soon as the Local Service is ready. Provider catalog requests wait until the panel receives focus for the first time.

The panel opens at a compact height and grows for draft content, attached files, menus, and the conversation. The Launcher bounds that growth by the visible screen and keeps the top edge in place when space allows. Manually resizing the window preserves that size for the Launcher session. The composer keeps attachment and send actions visible, groups other tools in one menu, and shows the model selection and execution destination below the input.

The panel is a local web view authorized by a fresh, one-time Launcher handoff. It uses the same Local Service routes, Browser Session limits, origin and CSRF checks, and Generation controllers as the full Chat Surface. The first submit creates an ungrouped Conversation. Continue in Cove uses a separate authenticated handoff for the same Conversation after any active Generation settles. The panel retains any unsent follow-up. See [Browser Session limits](0010-reuse-teampulse-browser-session-limits.md) and [Chat ownership](0012-make-chat-the-local-service-application-facade.md).

When a Chat Surface opens a Conversation with an active Generation Batch, it follows the existing Batch event stream, including private work still driven by the Quick Panel or another browser window. Explicit Stop can end the Batch. Chat's existing deadline expires unsettled private work if its owning window disappears. See [browser Generation lifetimes](0022-bound-browser-generation-lifetimes.md).

The panel starts a reply near its question and follows the end when the reader chooses Latest or scrolls to the end. Scrolling up preserves the current reading position as new text arrives.
