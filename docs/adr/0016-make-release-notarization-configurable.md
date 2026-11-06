# Make release notarization configurable

The macOS release workflow uses the `COVE_REQUIRE_NOTARIZATION` repository variable to select its signing policy and defaults the variable to `0`, allowing ad-hoc signed release artifacts while Apple credentials are unavailable. Setting it to `1` restores the Developer ID signing, notarization, stapling, and Gatekeeper requirements from ADR-0013; this temporary flexibility trades first-launch convenience and publisher verification for the ability to ship without Apple release credentials.
