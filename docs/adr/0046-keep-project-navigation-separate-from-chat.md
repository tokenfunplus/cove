# Keep project navigation separate from ordinary chat

Date: 2026-11-22

Status: Accepted

## Decision

Projects are an explicit workspace destination. Ordinary chat keeps its existing New chat, search and history navigation, with one compact Projects entry aligned with the conversation rows. Sidebar History and its search results show only ungrouped conversations, including the archived view. Project conversations remain accessible from their project home; workspace-wide exports still include them. Do not render project filters, membership selectors, project configuration forms, or project privacy explanations in the ordinary sidebar.

Projects opens a dedicated directory with project cards and a creation action. A project home presents its description, a new-chat draft entry and recent conversations on the left, with compact instruction, background and source-management rows on the right. Project-home drafts are window-local and retained per project while navigating. Start chat creates a conversation and transfers the typed draft through the existing discard/cancel safeguards; sending remains an explicit action in the chat composer. Project cards and the project home expose an actions menu with Edit project, Dissolve project and Delete project. Removal opens a compact, separate confirmation dialog rather than requiring a scroll through the context editor. Project conversation rows and the assigned-chat toolbar retain conversation actions, including moving to a different project or back to Ungrouped. Project-scoped search uses the existing server filter, including archived conversations. Creating a project closes the creation dialog and opens its home. Saving project edits closes the editor. Adding or removing fixed sources saves immediately and keeps the editor open for further source management.

The global New chat action, including Launcher entry points, always creates an ungrouped conversation. The New chat action inside a project home passes an explicit project identifier. When a draft or active work requires confirmation, retain that chosen destination through confirmation; do not infer membership from the previously selected conversation. This supersedes the earlier frontend behavior that inherited the current conversation's project for global creation. The storage and HTTP membership rules of ADR-0045 are unchanged.

Opening Projects or returning to the current chat preserves the in-progress draft and attachments. Selecting a different conversation or starting a new one retains the existing discard/cancel safeguards. Browsing project pages does not stop active generations. Automatic selection at startup, after deletion or archiving, and on switching History views chooses only an ungrouped conversation, or no conversation when none exists. Automatic selection changes do not close an open project page. Only an explicit accepted chat navigation or successful creation closes it; canceled navigation keeps the page and drafts intact.

Moving an existing conversation is an explicit action in its conversation menu. A move dialog offers a destination or No project. Ordinary chat has no always-visible membership dropdown. Moves still affect future batches only; saved snapshots retain their historical context. Moving to the current destination is disabled. A membership conflict requires refreshing current membership and explicitly choosing and submitting a destination again; it does not automatically retry a stale command.

Inside an assigned chat, a compact project breadcrumb links to its home. The composer shows a collapsed context summary; exact input, destinations, limits and privacy information remain available on demand. Over-limit input keeps its visible recovery action. Unassigned chats do not show project context controls or issue passive project-management reads.

## Compatibility

This is a frontend navigation and creation-policy change. It requires no database migration or new HTTP endpoint. Existing project membership, fixed sources, immutable batch contexts, citations, exports, branches, deletion rules and NearAI execution fragments remain unchanged.
