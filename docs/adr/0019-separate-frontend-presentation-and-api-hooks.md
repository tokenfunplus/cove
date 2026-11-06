# Separate frontend presentation and API hooks

Cove organizes its frontend around a small application entry, a composed chat page, domain presentation components, API query/mutation hooks, focused interaction controllers, and independent browser inference adapters. This adopts MedBox's component and presentation boundaries and Auto QA Alpha's API hook organization. LibreChat informs the separation of message, composer, and stream responsibilities.

## State ownership

- TanStack Query owns conversations, Provider Profiles, catalogs, settings, and fetched Generation Batches. Query keys distinguish active and archived lists and individual conversations.
- API hooks own command invocation, mutation retry policy, cache updates, and invalidation. Event-driven refreshes share these query keys.
- Workspace state owns the selected conversation and in-progress model selection. UI state owns dialogs, navigation, and local form interaction.
- Generation state owns the transient Live Turn and active browser operations. Ordinary SSE presentation and browser-driven NearAI inference use separate controllers and reconcile against persisted records.
- Query data contains local-session readiness. The HTTP client retains the CSRF proof. Browser UI state does not persist Provider Keys or conversation drafts to browser storage.

## Consequences

Presentation components compose existing actions rather than issue HTTP commands. The page provides the runtime composition point, and domain hooks own related interaction logic. The API layer uses the existing local-service endpoints and shared contract package. Creation and retry preserve client request IDs, and React Query does not automatically repeat commands that could start additional Provider work.

The browser inference adapter stays behind its existing narrow SDK boundary. Durable generation orchestration remains with Go Chat as established in ADR-0012. The global component stylesheet is replaced by Tailwind recipes and shared primitives in [ADR-0020](0020-use-tailwind-recipes-and-shadcn-primitives.md).

The dependency set already includes React and TanStack Query. Component-local and workspace-local UI state use React state. A shared client state library can be introduced when UI state genuinely needs independent consumers.
