# Reuse TeamPulse Browser Session limits

Cove reuses TeamPulse's local browser authorization model: a one-time Launcher token is valid for 45 seconds, the resulting Browser Session expires after 30 minutes of inactivity, and every session expires after 12 hours regardless of activity. The Local Service continues to require loopback, origin, session, and CSRF checks; these limits protect stale browser access without introducing a cloud account.

## Consequences

Restarting the Local Service invalidates its in-memory sessions and requires the Launcher to open a new authenticated browser URL. Multiple accidentally opened tabs may share a valid session, but multi-tab coordination is not a product feature.

The one-time Launcher exchange redirects to Cove with the Browser Session token in a URL fragment. The Chat Surface removes the fragment immediately and keeps the token in per-tab, origin-scoped session storage. Protected requests carry it in `X-Cove-Session-Token`. The Local Service serves the static shell before authorization so a new tab can complete the handoff. API reads still require a session, and API mutations also require the matching origin and CSRF token. Browser cookies are scoped to the host across loopback ports, so they are no longer used for Browser Sessions.
