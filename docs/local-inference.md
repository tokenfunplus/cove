# Local inference and retrieval acceptance

On this Mac installs BGE Small Chinese v1.5 Q8_0 for local document search, plus five independently selectable offline chat models: Qwen2.5 0.5B Instruct Q4_K_M, Qwen3 0.6B Abliterated Q5_K_M, Qwen2.5 1.5B Instruct Q4_K_M, Qwen2.5 Coder 1.5B Instruct Q4_K_M, and text-only Gemma 3 1B IT Q4_K_M. Model downloads use pinned Hugging Face revisions and SHA-256 verification. The registry is in `services/local-service/internal/localmodels/models.go`; runtime archive integrity is pinned in `scripts/prepare-inference-runtime.mjs`. See [ADR-0048](adr/0048-add-managed-local-inference-and-document-retrieval.md), [ADR-0054](adr/0054-add-qwen3-abliterated-local-chat.md), and [ADR-0069](adr/0069-add-qwen15b-and-gemma-local-chat.md) for lifecycle, storage, and compatibility decisions.

The optional native inference runtime requires an Apple Silicon Mac running macOS 13.3 or later. `make build-service` prepares the runtime before building the service. `COVE_INFERENCE_RUNTIME` can select a developer-built helper; it is a process configuration value, never a browser setting.

## Observed acceptance results

On 2026-11-21, real downloads and native inference passed the retrieval gate before the offline-chat gate on one Apple Silicon development Mac:

| Check | Observation |
| --- | --- |
| BGE verified download | 26,472,640 bytes; 2,114 ms |
| Chinese paraphrase retrieval | Recall@3: 12/12 queries |
| Returned citation sections | 96/96 exactly matched original source sections |
| First BGE load and embedding | 8,121 ms |
| Indexing / mean warm query | 117 ms / 1 ms |
| Explicit document scope and deletion | Passed |
| Qwen verified download | 491,400,032 bytes; 19,089 ms |
| Chinese extraction, rewriting, and explanation smoke checks | 3/3; 17 streamed text deltas |
| Qwen cold load / first text including load | 961 ms / 1,149 ms |
| Stop after first text | 9 ms; worker exited |
| Qwen worker peak resident memory | 690,913,280 bytes (approximately 659 MiB) |
| Saved Chat generation lifecycle | Passed |

These are small synthetic fixtures, not a representative retrieval or Chinese-language benchmark. Recall counts the expected document among the top three hits. Citation fidelity checks source identity and exact original sections, not the truth of model claims. Download times depend on the network; repeat runs use installed weights. Cold load means a new worker with existing weights and may benefit from operating-system caches. Peak resident memory is the operating system's per-process high-water mark after worker exit; it does not measure total GPU or system memory.

A final run with installed weights and warm operating-system caches also passed both gates: BGE load and first embedding took 372 ms with 150,568,960 bytes peak resident memory (approximately 144 MiB); Qwen load took 520 ms, first text arrived in 544 ms, Stop took 6 ms, and peak resident memory was 693,485,568 bytes (approximately 661 MiB). These repeat measurements illustrate cache sensitivity rather than replacing the first-run observations above.

WebUI verification imported a Chinese sample, selected it for search, opened the exact original lines, attached the results, and saved an offline answer with its source snapshot. Qwen correctly answered that the sample retained backups for seven days, but omitted the requested inline citation. The saved Sources control still opened the original lines. This is a known small-model instruction-following limitation; source fidelity checks must not be described as guaranteed model citation compliance. WebUI streaming and Stop were also exercised with a longer response.

Broader interactive checks on 2026-11-22 exposed incorrect factual answers and structurally incorrect code. This 0.5B model has not met acceptance for reliable factual question answering or coding. The three Chinese smoke checks establish only basic extraction, rewriting, and explanation behavior; they are not a general language-quality pass. The catalog and managed Provider description label the model experimental and narrow its suggested use to short rewriting and extraction from supplied material.

The initial native inference checks did not exercise the browser's offline state. A subsequent regression reproduced TanStack Query pausing loopback reads and commands when internet connectivity was lost. [ADR-0049](adr/0049-keep-loopback-requests-active-without-internet.md) fixes that scheduling policy. Automated workspace checks now cover opening while offline and receiving a browser offline event during streaming, including sending and stopping local Qwen work. These use simulated browser connectivity events; they do not toggle the host's network interfaces.

## Main sync verification

On 2026-11-22, the local-model changes were reapplied to main at `c58f325`, retaining Projects and their immutable context snapshots. [ADR-0052](adr/0052-combine-projects-and-local-model-storage-migrations.md) moves the library migration to schema 25 and preserves the earlier local-only schema-23 preview layout. Upgrade regressions cover that preview and mainline schema 24; the running preview also upgraded with its recorded conversation, message, Batch, library, and chunk counts unchanged and SQLite integrity intact.

Post-sync checks passed `make check`, 469 Web tests, nine contract tests, 48 script tests (one optional DMG test skipped), and the full Go race suite. Repeated native gates using installed weights and an unreachable external proxy returned Recall@3 of 12/12 and exact source sections of 96/96. Qwen passed the same three limited Chinese smoke checks with 17 text deltas, 716 ms to first text including load, and an 8 ms Stop. These remain synthetic smoke observations, not general quality acceptance.

A separate disposable service staged in the package's `Contents/Resources` layout found its sibling inference runtime without `COVE_INFERENCE_RUNTIME`. Fresh authenticated install commands downloaded and verified BGE (26,472,640 bytes) and Qwen (491,400,032 bytes), with progress observed for both. After restart with an unreachable external proxy, API checks passed local Provider discovery, document import/index/search, original-section selection, Qwen chat with Project context and retrieved sources, saved answers/source snapshots, and model removal with originals/history retained as specified.

WebUI checks confirmed the Projects directory, the 27-entry catalog, and both installed models after the preview upgrade. The native Swift test target still failed before running tests because the host Command Line Tools could not link the SwiftPM `PackageDescription` manifest. The relocated service/runtime checks do not replace a built Launcher, signed/notarized DMG, or full package acceptance.

## Product integration verification

On 2026-11-22, [ADR-0053](adr/0053-integrate-local-capabilities-into-chat-and-projects.md) integrated local capabilities with the composer, model selection, Installed/Discover management, Project materials, and the Only on this Mac execution policy. Schema 26 preserves existing materials as Always include and existing Batches without the new policy. The running preview upgraded with its recorded conversation, message, Batch, library, chunk, Project, and material counts unchanged and SQLite integrity intact.

Checks passed `make check`, 474 Web tests, nine contract tests, and the full Go race suite. A final API race run covers preservation of the execution policy in create, saved-Batch, and conversation responses. After the final interface adjustments, another 111 focused Web tests and the Web production build passed.

A disposable service in the package's `Contents/Resources` layout used the bundled native runtime without an override and an unreachable external proxy. It passed Project-scoped indexing and retrieval, exclusion of Search when needed materials from fixed context, exact original-section selection, Project-bound source preparation, local Qwen generation with a saved local-only policy, rejection of Web research under that policy, and preservation of old context snapshots after changing material usage. This checks the native service and runtime; it does not replace full Launcher or DMG acceptance.

WebUI checks exercised the Installed hub, Use in this chat, preservation of an unsent draft, the composer Tools entry, and the execution-location indicator. Interaction tests additionally cover installing BGE from document search without losing the draft and blocking remote generation or webpage preparation under Only on this Mac. The policy applies to Chat and Answer tools; catalog downloads still require internet access. The catalog retains 27 discovery entries, with only BGE and Qwen integrated for installation and execution in Cove.

## Qwen3 Abliterated trial

On 2026-11-22, the publisher's Q5_K_M file was downloaded at revision `92351f431cfdd36f71149aaf072a6490a68e144e`. The 444,415,104 bytes matched SHA-256 `5f850d7369a02a318da85cf9b5deac9ab3f2f1cfe01f4ba48b68f6f7a72db87b`. The verified weights were staged in a disposable data directory for native checks with an unreachable external proxy.

The same three limited Chinese smoke cases passed, producing 21 streamed text deltas. A fresh worker loaded in 1,649 ms and returned its first text in 1,774 ms including load. Stop took 9 ms; peak worker resident memory was 1,075,691,520 bytes (about 1.08 GB). Weights were already staged, so this run does not measure download or first-ever filesystem-cache latency. These synthetic checks do not establish general answer quality or the effectiveness of refusal reduction.

The isolated runnable Local Service also completed a Chinese chat request with Only on this Mac enabled, discovered Qwen3 when it was the only installed chat model, and returned the selected model's revision/hash in saved API snapshots. Qwen3 uses its embedded template with thinking disabled. The original Qwen2.5 model identity and files remain independently supported.

## Reproduce the gates

Additional lifecycle regression checks on 2026-11-22 cover model removal racing Generation admission, canceled inference/library leases, stopping before response headers, clearing during document parsing, late source responses after dialog closure, multi-file imports beyond four documents, stopping an import batch, and removal of cached library metadata. The corresponding implementation decision is [ADR-0050](adr/0050-serialize-local-model-and-document-lifecycle-changes.md).

Prepare assets and runtime, then run the opt-in tests with a temporary data directory. The first command downloads BGE; only after its success should the second gate download Qwen. Ordinary tests do not download model weights.

```sh
make build-service
export COVE_TEST_LOCAL_INFERENCE=1
export COVE_DATA_DIR="$(mktemp -d /private/tmp/cove-inference-acceptance.XXXXXX)"
export COVE_INFERENCE_RUNTIME="$PWD/.artifacts/inference/llama-server"
scripts/go -C services/local-service test ./internal/retrieval -run TestRealLocalRetrievalAcceptance -v -count=1
scripts/go -C services/local-service test ./internal/localmodels -run TestRealOfflineChatAcceptance -v -count=1
```

To exercise another model with the same offline-chat gate, set `COVE_TEST_CHAT_MODEL` to `qwen3-abliterated-chat`, `qwen25-1-5b-chat`, `qwen25-coder-1-5b-chat`, or `gemma3-1b-chat` for the second test command. The default remains Qwen2.5 0.5B. Each selected model is downloaded only when its verified weights are absent from the temporary data directory.

The fixtures and assertions live in the corresponding `acceptance_test.go` files and `internal/retrieval/testdata/chinese-retrieval.json`. Keep this data directory separate from everyday Cove data. No Provider credentials are needed for these tests.

## Recovery and result controls

Interrupted model transfers can resume on retry when the pinned source supports HTTP ranges. Complete files still pass size and SHA-256 checks before installation. Cancel discards partial files; failed downloads also offer Discard partial download. Speech bundles use the same recovery policy.

Document search offers a Minimum similarity filter. Zero includes all non-negative matches; higher values can return no results. This user-selected cutoff is not a confidence estimate or a calibrated answer-quality threshold. Results skip chunks whose original source sections are already represented.

Local chat reports waiting, model preparation, and generation activity. Switching inference models unloads the previous worker; switching back may require loading again. See [ADR 0058](adr/0058-improve-local-capability-feedback-and-recovery.md).

## Additional chat model acceptance

On 2026-11-26, the three Q4_K_M artifacts in [ADR 0069](adr/0069-add-qwen15b-and-gemma-local-chat.md) were downloaded from their pinned public sources, checked against their exact sizes and SHA-256 digests, and staged in a disposable data directory. Each passed the existing native offline-chat gate with llama.cpp b12606 and an unreachable external proxy:

| Model | Chinese smoke cases | Streamed text deltas | First text including load | Stop | Peak process resident memory |
| --- | --- | --- | --- | --- | --- |
| Qwen2.5 1.5B Instruct | 3/3 | 28 | 8,164 ms | 10 ms | 1,378,353,152 bytes |
| Qwen2.5 Coder 1.5B Instruct | 3/3 | 22 | 1,148 ms | 10 ms | 1,385,447,424 bytes |
| Gemma 3 1B IT | 3/3 | 30 | 1,107 ms | 7 ms | 996,786,176 bytes |

Each gate also completed a Chat-owned local-only Generation and verified the saved answer's selected artifact revision and hash. The files were staged before the gate, so its install call reused verified weights; the reported timings exclude downloads. These are limited synthetic extraction, rewrite, and explanation cases on one Apple Silicon development Mac, not representative Chinese, coding, or speed benchmarks. The different load times may include first-use runtime and operating-system cache effects. Model selection, file-size filtering, and unsent-draft preservation are additionally covered by workspace interaction tests.
