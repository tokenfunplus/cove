# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/tokenfunplus/cove/security/advisories/new) when available. If it is not enabled, request a private security contact in an issue without including exploit details, credentials, or conversation data. Coordinate with maintainers before public disclosure.

Include the affected revision, platform, reproduction steps, expected security property, observed impact, and a minimal example using synthetic data. Maintainers investigate reports as capacity allows; no response-time or bounty commitment is implied.

## Supported code

Security fixes target the latest release and `main`. Earlier versions may require an upgrade. See the [privacy and trust model](docs/privacy.md) for intended guarantees and limitations.

Areas requiring particular care include local browser authorization, loopback and origin enforcement, CSRF, endpoint validation, Provider Key handling, cancellation and deletion, context selection, and the accuracy of verification labels. A compromised local account or browser is outside the protection provided by local session checks.

## Dependency review

Run `pnpm audit` and review the full findings, including low-severity advisories and transitive dependencies. CI runs `pnpm run audit:dependencies` and blocks unpatched moderate-or-higher npm advisories. The gate verifies all installed standalone and bundled parser patches before recognizing one exact advisory revision as locally patched; raw `pnpm audit` still reports the published affected version. See [local dependency patches](docs/dependency-patches.md) for compatibility, integrity checks, and removal criteria. A passing audit does not establish the absence of vulnerabilities. Known dependency limitations are recorded in [privacy.md](docs/privacy.md).

## OpenSSF Scorecard

The [Scorecard workflow](.github/workflows/scorecard.yml) checks repository security practices on pushes to `main` and weekly on Mondays at 03:23 UTC. It publishes results to the public OpenSSF Scorecard API for the README badge, uploads a SARIF report to GitHub code scanning, and retains the report as an Actions artifact for five days. The badge becomes available after the first successful publication; it is a changing assessment of repository practices, not a certification or a guarantee about Cove's runtime security.

The workflow uses GitHub's automatic token and OIDC identity; no personal access token or Provider Key is required. Write permissions are limited to code-scanning results and OIDC in the analysis job. Actions are pinned to full commit SHAs, with updates proposed by the existing Dependabot configuration. See the [official action documentation](https://github.com/ossf/scorecard-action#readme) for publishing restrictions and troubleshooting. Check the analysis logs and the public result as well as the workflow status when verifying publication.

Repository settings also affect the score and are configured separately from tracked files. The `main` ruleset is recorded in [.github/rulesets/main.json](.github/rulesets/main.json); it requires pull requests, resolved review threads, and the `test`, `package-macos`, `Analyze (go)`, and `Analyze (javascript-typescript)` checks against the current base branch. It blocks force pushes and branch deletion with no administrator bypass. Independent approval is not mandatory while the project has one human maintainer; add another reviewer before enabling that requirement. AI reviews do not substitute for human code-review history. See [ADR-0028](docs/adr/0028-require-pr-checks-and-sign-published-downloads.md). Scorecard can read repository rulesets with the automatic token. Review the [published results](https://scorecard.dev/viewer/?uri=github.com/tokenfunplus/cove) to prioritize further improvements rather than assuming a target score.

## Source analysis and fuzzing

The [CodeQL workflow](.github/workflows/codeql.yml) runs extended security queries for Go and JavaScript/TypeScript on pull requests, pushes to `main`, and weekly. CI also runs active Go fuzzing for text-document snapshots and Provider SSE parsing. See [development.md](docs/development.md#security-checks-and-fuzzing) for targets, time budgets, and regression inputs. Swift analysis is not included in this workflow.
