# Independent Travel Phrasebook author process

Recorded on 2026-11-28 by a fresh Codex sub-agent (`independent_public_author`,
`fork_turns=none`). The main agent subsequently published, installed and updated
these exact packages through the local signed-market browser walkthrough.

This is a record of actual authoring attempts using the supplied public author kit and public CLI. The author did not read the host source tree, Git history, private APIs, credentials, conversations, or other agents' tasks. The working directory known from the environment was never inspected. All writes were made beneath this kit's `output/` directory. The guide contains source-development commands; none of those commands were executed.

## Supplied materials

The permitted inputs were the supplied `public-kit/` directory and sibling `coveapp` executable. Initial reads used the macOS `/var/` path alias; the scripts resolve it to the same `/private/var/` files. An initial `ls -la public-kit` inspected its top-level inventory. Only the following file contents were read; hashes identify the exact supplied bytes:

| Material actually read | Bytes | SHA-256 |
| --- | ---: | --- |
| `coveapp` | 26802592 | `5df2cd38feea04da4891a95ee1da806e975f136531b73116c5d633fe80bb95a0` |
| `public-kit/authoring.md` | 35836 | `f6e8d6d1429b25f7e805935377a46cdf5789d67a6f85c732f6255ead9bf94179` |
| `public-kit/mini-app-v1.schema.json` | 15813 | `9d9428e2096399a81e20f7e5f26ef3f057360b945aecffad4f206f71f4721872` |
| `public-kit/examples/starter.coveapp` | 779 | `92707bd5b413fa8293e3d5bbe082fdf507b12483a8ef3c0482bd2fe97de91b2e` |
| `public-kit/examples/reading-inbox-1.1.coveapp` | 4166 | `f9c40c6ca9bc9c0aeb3999183f8dacff44253129aa2075a70d4758576c9903bd` |
| `public-kit/scenarios/reading-inbox-upgrade.json` | 1126 | `a91a3f828c3c2965e719d18d36fbc91c5f9d656bc601c088133ae916ca1ae86a` |
| `public-kit/scenarios/japanese-review-book.json` | 1205 | `92c156e0ef9617d7fd733d9a827f8ecc0d391f25b40f6412fb577a5eded715f8` |
| `public-kit/examples/japanese-review-book-1.1.coveapp` | 13824 | `8f5c7f4108bd496cc616a973109272fdba49c47786d43f4b25e15223c5772e55` |

## Authoring and actual iterations

1. Read `authoring.md`, the JSON schema, and the listed public examples/scenarios. Invoked the sibling executable with `--help`; it reported the public init, validate, preview, test, upgrade-test and pack commands and exited 0.
2. Designed a distinct `waypoint-lab/travel-phrasebook` package. It uses one `phrases` collection with travel-specific text, language and situation fields, a cumulative error count, and a review date. The practice page reveals the translation after the phrase; the library filters by both language and situation and supports create/edit; the plan exposes tomorrow, within-two-days and seven-days queries.
3. Wrote `build-artifacts.py` using only Python standard-library JSON construction. It generates the 1.0.0 and 1.1.0 package sources and three public CLI fixtures. No host identifiers, runtime code or unpublished declarations were used. No `init` scaffold was needed.
4. The stumble rule increments the previous `errors` and sets tomorrow. Recall deliberately keeps the cumulative error history: fewer than two errors schedules seven days; two or more schedules two days. This is an authored policy, not a host-specific app shortcut.
5. Authored 1.1.0 as an additive schema-2 upgrade: each existing phrase receives `starred=false` and `uses=0`; new creates initialize both. A useful-phrase action stars and increments uses, and unstar preserves the cumulative use history. All original fields and scheduling rules are retained.
6. Ran `run-checks.py` once. All 11 CLI commands exited 0. Both packages and all scenarios passed on the first attempt; there were no CLI errors, package corrections, inferred undocumented workarounds or host changes. There was one authoring iteration, not an invented failure-and-repair narrative.
7. Wrote this process record, the machine-readable `summary.json`, file hashes, and retained exact CLI outputs under `logs/` and `check-results.json`.

## Exact public CLI commands and results

The help command was:

```sh
author-kit/coveapp --help
```

The verification runner set `COVE_DATA_DIR` to the disposable `output/runtime-data` directory for every invocation. Public non-browser preview, test and upgrade-test use the isolated instance lifecycle described in the author guide; no existing user state was loaded. Each command below was invoked once from `output/`:

```sh
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp validate author-kit/output/travel-phrasebook-v1.0.source.json
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp pack author-kit/output/travel-phrasebook-v1.0.source.json author-kit/output/travel-phrasebook-v1.0.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp validate author-kit/output/travel-phrasebook-v1.0.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp preview author-kit/output/travel-phrasebook-v1.0.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp test author-kit/output/travel-phrasebook-v1.0.coveapp author-kit/output/travel-phrasebook-v1.0.scenario.json
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp validate author-kit/output/travel-phrasebook-v1.1.source.json
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp pack author-kit/output/travel-phrasebook-v1.1.source.json author-kit/output/travel-phrasebook-v1.1.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp validate author-kit/output/travel-phrasebook-v1.1.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp preview author-kit/output/travel-phrasebook-v1.1.coveapp
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp test author-kit/output/travel-phrasebook-v1.1.coveapp author-kit/output/travel-phrasebook-v1.1.scenario.json
COVE_DATA_DIR=author-kit/output/runtime-data author-kit/coveapp upgrade-test author-kit/output/travel-phrasebook-v1.0.coveapp author-kit/output/travel-phrasebook-v1.1.coveapp author-kit/output/travel-phrasebook-upgrade.json
```

Every command above returned exit code 0. `check-results.json` retains argv, working directory, environment override, stdout, stderr, and exit code. Each `logs/*.log` contains the same exact command and output.

## Fresh-install checks

- Version 1.0.0: 23 scenario steps. Confirms both repeated-error and low-error scheduling branches, tomorrow and seven-day date queries, no due records after rescheduling, saved user phrases, default notes, edit persistence, language/situation predicates, Unicode phrase retention, and page/chat/panel calls.
- Version 1.1.0: 32 scenario steps. Repeats the 1.0 behavior, checks new record defaults, stars a phrase, increments uses on repeated usefulness, removes it from the pocket list without losing its use history, and stars it again with the next cumulative count.
- Both packed artifacts separately passed `validate` and text-mode `preview`; previews showed the authored pages/actions and the fictional seeded phrase records.

## Upgrade check

The fixture intentionally grants only `records.query` and `records.commit` although the package declares `chat.attach` too. Its eight pre-upgrade steps update a seeded phrase, create a fictional personal phrase, accumulate its error history and edit its translation before upgrading. The 16 after-upgrade steps assert all three old records remain, original text and Unicode notes remain, new defaults exist, and the original due-date behavior still holds. They then exercise the new star/use rules and create a new schema-2 record.

The public CLI reported:

```text
ok 1.0.0 -> 1.1.0: saved fields, record revisions, 0 attachments and 2 grants verified
```

The authoring guide says this runner uses the production upgrade operation and compares instance identity, active release, existing counts, IDs and fields, revision changes and retained grants. This record reports that public runner result; no host database or implementation was inspected. No attachments were present, so zero-attachment verification proves no attachment-preservation behavior.

## Reproduce the delivered artifacts

The repository retains the two exact authored packages and three scenario files in
`docs/examples/independent-mini-app/`. Run the same production CLI against them:

```sh
coveapp validate docs/examples/independent-mini-app/travel-phrasebook-v1.0.coveapp
coveapp validate docs/examples/independent-mini-app/travel-phrasebook-v1.1.coveapp
coveapp test docs/examples/independent-mini-app/travel-phrasebook-v1.0.coveapp docs/examples/independent-mini-app/travel-phrasebook-v1.0.scenario.json
coveapp test docs/examples/independent-mini-app/travel-phrasebook-v1.1.coveapp docs/examples/independent-mini-app/travel-phrasebook-v1.1.scenario.json
coveapp upgrade-test docs/examples/independent-mini-app/travel-phrasebook-v1.0.coveapp docs/examples/independent-mini-app/travel-phrasebook-v1.1.coveapp docs/examples/independent-mini-app/travel-phrasebook-upgrade.json
```

`node --test scripts/mini-app-authoring.test.mjs` builds the current CLI and runs
these public checks with a temporary data directory. The original author's
standard-library generators and logs remain in the isolated acceptance artifacts;
they are listed below for provenance, rather than installed into the host.
Dates use authored `$today` expressions, so the scenarios are not tied to the
original calendar date.

## Output artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `travel-phrasebook-v1.0.coveapp` | 6931 | `5302a35face242eeb9b3292ee00f2d764fd36563c6b60c19b8f3444406eaae08` |
| `travel-phrasebook-v1.1.coveapp` | 8676 | `8f59b627d9d2c3c329577d9d266ee190c0e8b06193911d5e5caa85831ef7d27f` |
| `travel-phrasebook-v1.0.source.json` | 6931 | `5302a35face242eeb9b3292ee00f2d764fd36563c6b60c19b8f3444406eaae08` |
| `travel-phrasebook-v1.1.source.json` | 8676 | `8f59b627d9d2c3c329577d9d266ee190c0e8b06193911d5e5caa85831ef7d27f` |
| `travel-phrasebook-v1.0.scenario.json` | 4191 | `02061930d9e743645d776196b2e6c52f0a63c1ebfe0bdedeed69d0b74a79483a` |
| `travel-phrasebook-v1.1.scenario.json` | 5914 | `cbbd740b45311fb844197baf88e0897c28b670ab4f07bd182cb01966fe8075c9` |
| `travel-phrasebook-upgrade.json` | 4919 | `5843591ae8e238c6603cd2a9f8fd89f37f7f156b332d0b527bfd1d77a834d385` |
| `build-artifacts.py` | 11392 | `af2fb48057a74556df46c66a43c5605293b0773486d0cf8260fe420b8fe8667c` |
| `run-checks.py` | 2152 | `6709b82a25b778c2aeca16c862a14a3998fb5bc53a77cf048c48e6da86eff2fd` |
| `write-process-record.py` | 12440 | `b12bb7b2cd4b70f4190d2404fec6ff7666d020596f3108af54c73f59334511a7` |

Additional evidence: `check-results.json`, `logs/`, this `process-record.md`, and `summary.json`.

## Limits

- Text-mode public preview only; no browser, installed desktop UI, accessibility or visual QA was performed.
- Surface tests invoke page/chat/panel through the public scenario runner; no real conversation turn, model proposal or draft attachment was exercised.
- No model actions, model calls, providers, networking, speech, documents, native file selection, attachments, backups, deletion or catalog publishing were used.
- Upgrade preservation is the public CLI production-lifecycle assertion and fixture result, not an independent database/source inspection.
- Two seeded fictional public examples and one fictional user-created record are small data fixtures; pagination and quotas were not stress-tested.
- This demonstrates one declarative travel app and one additive schema upgrade, not unrestricted arbitrary-code app extensibility.
- The supplied executable was used as-is and was not built or source-audited by the independent author.

No external network, publication, release, push, installed-instance import or third-party contact was performed. The outcome supports public-format authoring of this distinct app and an additive upgrade with the supplied CLI. It does not establish arbitrary executable-code extensions or any untested host capability.
