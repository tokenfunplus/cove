# Reuse TeamPulse Browser Session limits

Cove reuses TeamPulse's local browser authorization model: a one-time Launcher token is valid for 45 seconds, the resulting Browser Session expires after 30 minutes of inactivity, and every session expires after 12 hours regardless of activity. The Local Service continues to require loopback, origin, session, and CSRF checks; these limits protect stale browser access without introducing a cloud account.

## Consequences

Restarting the Local Service invalidates its in-memory sessions and requires the Launcher to open a new authenticated browser URL. Multiple accidentally opened tabs may share a valid session, but multi-tab coordination is not a product feature.
