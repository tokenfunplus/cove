---
status: partially superseded by ADR-0018
---

> Historical decision. Current Cove identity and defaults are defined in [ADR-0018](0018-establish-cove-project-conventions.md).

# Use the TBD application data directory

TBD stores its SQLite database, logs, runtime state, and other local application data under `~/Library/Application Support/tbd/`. `TBD` is the intentional final product name rather than a temporary placeholder, so the lowercase `tbd` directory is the stable app-specific child of macOS's Application Support directory.
