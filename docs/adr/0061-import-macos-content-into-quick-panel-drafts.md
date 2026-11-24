# Import selected text into Quick Panel drafts

Extend [ADR 0059](0059-add-the-macos-quick-panel.md) with Ask Cove in macOS Services. The source app provides the selected plain text when the user invokes the service. The Launcher opens the Quick Panel to review the selection.

When a new chat has an empty draft, Cove fills it with the selection. If a draft or conversation is already open, the user can add to the current draft, replace it with a new draft, or dismiss the selection. The selection waits while an answer is running. Model selection and the explicit Send command follow the same rules as typed text. The Local Service enforces Only on this Mac when admitting a generation.

The Launcher delivers a selection identifier and up to 60,000 UTF-8 bytes of plain text in memory to the trusted loopback Quick Panel page through argument-bound WebKit calls. It holds each selection until the page applies, dismisses, or rejects it. A new Quick Panel document receives any selections still awaiting review. The receiving panel validates and bounds pending selections and deduplicates repeat deliveries. Submission retains the existing model limits.

Verify macOS Services discovery and selection delivery using an installed package. Draft interaction tests cover pending selections during generation, explicit replacement of unsent content, and review before sending.
