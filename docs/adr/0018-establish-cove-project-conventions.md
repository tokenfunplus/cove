# Establish Cove identity and open-source conventions

The supplied Secure Chat / TBD project becomes Cove, using bundle identifier `io.github.tokenfunplus.cove`, data directory `~/Library/Application Support/cove/`, database `cove.sqlite`, the `@cove` scope, and `COVE_` environment variables. This supersedes the identity decisions in ADR-0003 and ADR-0009. Earlier data and Keychain entries are not automatically migrated.

English is the supported interface and documentation language. Legacy locale preferences remain readable and resolve to English. User messages, titles, and prompts continue to support Unicode.

Keychain is the default Secret Store. ADR-0017's file store remains available through explicit test opt-in; this supersedes that decision's default. Fixtures use dedicated data directories rather than changing the user's home directory.

Generated web bundles are built before compiling a runnable service and stay untracked. A small setup page permits Go tooling before a web build. Internal scratch files and machine-specific instructions are excluded from the public project.
