---
status: partially superseded by ADR-0018
---

> Historical decision. Current Cove identity and defaults are defined in [ADR-0018](0018-establish-cove-project-conventions.md).

# Target Apple Silicon macOS 13 with provisional app identity

The first TBD distribution targets Apple Silicon Macs running macOS 13 Ventura or newer, matching the proven TeamPulse launcher baseline. The product name is `TBD`, the Bundle Identifier is `com.protonestlab.tbd`, and the application data directory is `~/Library/Application Support/tbd/`.

## Consequences

Intel Macs are outside the MVP support contract. The lowercase `tbd` storage directory is part of the product's persistent local-data contract; changing the deployment target, Bundle Identifier, product name, or data directory later requires an explicit release decision and compatibility review.
