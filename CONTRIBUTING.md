# Contributing to Cove

Bug reports, documentation improvements, and focused pull requests are welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

Search existing [issues](https://github.com/tokenfunplus/cove/issues) and discuss substantial changes before implementing them. Include the intended behavior and why it is useful. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Local workflow

1. Fork or clone the repository and create a branch.
2. Follow the prerequisites and setup in [development](docs/development.md).
3. Make a focused change. Use English for project text; conversations may contain any language.
4. Add regression coverage for behavior changes and update relevant documentation.
5. Run `make check` and affected test targets. Run `make test` on macOS for changes across components.
6. Open a pull request explaining the problem, resulting behavior, and actual validation. Include screenshots for visual changes and call out tests you could not run.

Keep credentials and personal conversations out of examples and screenshots. Integration tests should use temporary data directories and mock providers rather than paid external services.

## Design expectations

Use the [domain glossary](CONTEXT.md). Preserve idempotent sends, immutable context snapshots, explicit comparison-answer selection, cancellation before deletion, and the distinction between transport security and response verification. Record material design changes in `docs/adr/`.

JavaScript dependencies are managed by pnpm and its lockfile. Go dependencies use `go.mod` and `go.sum`. Avoid unrelated dependency upgrades or large formatting changes in a behavioral fix.

## License

By contributing, you agree to license your contributions under the repository's [MIT license](LICENSE). Preserve third-party notices when copying code or adding dependencies.
