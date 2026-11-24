# Configure model download proxies in Settings

Date: 2026-11-24

Status: Accepted

This extends ADR 0048, 0050, 0053, 0055, and 0058. It changes download routing only and preserves ADR 0057's proxy-free private worker transport. No database migration is required.

## Decision

Settings > Network configures verified inference, retrieval, and speech artifact downloads. Users choose System proxy (default), Manual proxy, or Direct connection. Failed download controls link to Network settings. Applying a configuration takes effect for the next installation or retry without restarting Cove. Each installation captures its own configured client; saving does not reroute an active installation.

On cgo-enabled macOS builds, CFNetwork resolves native system proxy settings for each destination, including exceptions and bounded PAC evaluation. An explicit system DIRECT result takes precedence over environment variables. When no system proxy is configured, use `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` (and their lowercase forms). Other builds use that environment fallback. Direct mode bypasses both sources. Manual mode accepts HTTP, HTTPS, SOCKS5, and SOCKS5H URLs with explicit ports. Loopback and `.localhost` destinations always bypass download proxies.

Manual addresses must not include user information, paths, queries, or fragments. Authenticated proxies are not supported by this version. Native resolution errors fail closed rather than silently switching to another route. Diagnostics never include raw proxy errors or signed artifact URLs.

Routing correction (2026-11-24): preserve supported CFNetwork/PAC routes in their returned order. For a bodyless GET or HEAD, a connection failure before receiving a response tries the next listed route within the existing request deadline. Direct fallback is allowed only when the system list explicitly includes DIRECT. A configured system proxy never falls back implicitly to Direct or the environment. Resolution errors, invalid configurations, or lists exceeding 32 supported routes fail closed. HTTP responses and partially consumed artifacts are not replayed through another route; ordinary validated download retry handles interrupted artifacts.

`internal/downloadnetwork` owns validation, routing, and connection checks. Persistence atomically saves the non-secret machine preference as an owner-only `download-network.json` under the application data directory. This machine-specific file is separate from conversation backups and exports. Missing files use System; invalid files fail closed and can be replaced in Settings. Save failure retains the previous configuration.

Authenticated, CSRF-protected settings endpoints accept a bounded, strict JSON object. Connection tests use the draft without saving it, visit only fixed HTTPS registry targets on Hugging Face and GitHub, honor existing host-restricted redirects, request a small range, read at most 64 bytes per source, and have a 12-second deadline. Browser callers cannot supply a test destination.

The source byte budget includes response bodies across redirects. Probe redirects are closed without draining their bodies, leaving at most 64 bytes for the final response. This is a response-body consumption limit, not a limit on HTTP headers or transport buffering.

## Consequences

Users can recover downloads from a GUI-launched app without a terminal or inherited shell environment. A proxy app still needs to be running when its manual address is selected. Existing pinned artifact identities, resume validation, SHA-256 checks, archive validation, cancellation, and download deadlines remain in force.

This preference does not alter Provider inference, Web Research, webpage reading, Launcher update checks, or native inference communication. Broader application-wide routing and proxy credentials require separate decisions.
