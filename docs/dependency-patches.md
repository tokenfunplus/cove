# Local dependency security patches

Cove applies pnpm patches to its build and test dependencies while no fixed release is available for [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). The advisory reviewed on November 17, 2026 affects picomatch through 4.0.7. Vite 7.3.7, Vitest 4.1.12, tinyglobby 0.2.17, and fdir 6.5.0 resolve to that parser. Rollup 4.63.1 also embeds six parser copies across four distribution files. Updating only the standalone package leaves those bundled copies unchanged.

## Patch behavior and compatibility

`pnpm-workspace.yaml` and the frozen lockfile apply [the picomatch patch](../patches/picomatch@4.0.7.patch) and [the Rollup patch](../patches/rollup@4.63.1.patch). These are Cove-local conservative changes, not an upstream fixed version. Repeated extglobs can otherwise compile to ambiguous nested regular-expression repetitions and consume excessive CPU on a nonmatching input.

The parser retains its existing safe flattening of character repetitions. Other repeated extglobs may repeat only prefix-free ASCII literal alternatives. Wildcards, regex syntax, quoted/non-ASCII branches, and escaped branches use the parser's existing literal fallback. Case-insensitive comparisons fold ASCII case; rejecting escapes also covers `unescape` and Windows separator aliases. Setting `maxExtglobRecursion: false` relaxes the depth limit without disabling this ambiguity guard.

This intentionally restricts complex repeated-extglob syntax in build/test filters. Ordinary project globs, braces, dotfiles, escaped filenames outside repeated extglobs, negated extglobs, simple alternatives such as `+(foo|bar)`, and Vite include/exclude filtering retain their tested behavior. No application chat input is intentionally routed into these build-time glob filters.

## Audit gate

Run `pnpm run audit:dependencies` for the CI gate, and `pnpm audit` to inspect the registry's raw report. The raw report still identifies the published package version as vulnerable: the registry cannot inspect local patches.

The gate first checks the exact lockfile inventory and every reachable installed picomatch/Rollup package version and patched source checksum. It follows pnpm consumer dependency edges, including aliases and peers, rather than unused cache directories. Missing, additional unpatched, renamed, modified, or differently versioned parser copies fail closed. The lockfile checksum forces dependency changes to receive a new bundled-copy review.

Only after verification may the gate recognize this exact advisory revision as locally patched. Its identifier, CVE, affected version/range, absence of an upstream fix, and update timestamp must match. Changed advisory records require renewed review. Registry failures, malformed/incomplete reports, muted findings, and all other moderate-or-higher advisories remain blocking. The existing low-severity SDK elliptic advisory remains visible. No advisory-wide pnpm ignore rule or `--ignore-unfixable` option is used.

## Verification and maintenance

`node --test scripts/dependency-security.test.mjs` exercises the public matcher and direct compiled-regex sink in bounded child processes, including single-branch attacks, alternate encodings, flags, `unescape`, and Windows separators. It checks all six Rollup analyzers, legitimate filters, checksum/inventory tampering, and audit failure handling. These checks also run under `make test-scripts`. Production web builds and browser acceptance exercise the patched bundler in Cove's normal workflow.

When changing the dependency graph, inspect all standalone and bundled parser copies, regenerate the pnpm patches and lockfile, update the reviewed checksums in `scripts/audit-dependencies.mjs`, and rerun the regression suite, `make check`, the web tests/build, browser acceptance, and the audit gate. Do not merely copy a new checksum to make CI green. Review upstream releases and the advisory again; remove both local patches and the exact-advisory recognition once a verified upstream release replaces every affected copy.
