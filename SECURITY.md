# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/tokenfunplus/cove/security/advisories/new) when available. If it is not enabled, request a private security contact in an issue without including exploit details, credentials, or conversation data. Coordinate with maintainers before public disclosure.

Include the affected revision, platform, reproduction steps, expected security property, observed impact, and a minimal example using synthetic data. Maintainers investigate reports as capacity allows; no response-time or bounty commitment is implied.

## Supported code

Security fixes target the latest release and `main`. Earlier versions may require an upgrade. See the [privacy and trust model](docs/privacy.md) for intended guarantees and limitations.

Areas requiring particular care include local browser authorization, loopback and origin enforcement, CSRF, endpoint validation, Provider Key handling, cancellation and deletion, context selection, and the accuracy of verification labels. A compromised local account or browser is outside the protection provided by local session checks.

## Dependency review

Run `pnpm audit` and review the full findings, including low-severity advisories and transitive dependencies. CI blocks moderate-or-higher npm advisories. A passing audit does not establish the absence of vulnerabilities. Known dependency limitations are recorded in [privacy.md](docs/privacy.md).
