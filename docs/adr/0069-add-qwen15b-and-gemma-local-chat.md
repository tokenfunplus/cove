# Add Qwen2.5 1.5B, Qwen2.5 Coder 1.5B, and Gemma 3 1B local chat

Date: 2026-11-26

Status: Accepted

This extends the independent managed chat targets in [ADR 0054](0054-add-qwen3-abliterated-local-chat.md) and raises the discovery file-size ceiling in [ADR 0051](0051-expand-small-model-discovery-by-task.md) from 500 MB to 1.5 GB.

Three Q4_K_M GGUF artifacts become explicitly installable and independently selectable:

| Target | Model | Revision | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `qwen25-1-5b-chat` | Qwen2.5 1.5B Instruct | `91cad51170dc346986eccefdc2dd33a9da36ead9` | 1,117,320,736 | `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e` |
| `qwen25-coder-1-5b-chat` | Qwen2.5 Coder 1.5B Instruct | `f86cb2c1fa58255f8052cc32aeede1b7482d4361` | 1,117,320,768 | `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046` |
| `gemma3-1b-chat` | Gemma 3 1B IT | `116f76234503685a98f572982177b11d44ec8ff1` | 806,058,496 | `12bf0fff8815d5f73a3c9b586bd8fee8e7b248c935de70dec367679873d0f29d` |

The Qwen artifacts come from the publisher's GGUF repositories under Apache-2.0. Gemma uses bartowski's conversion, identifies Google as its model publisher, and retains the custom Gemma model license. Source revisions, exact sizes, and digests were checked against public Hugging Face artifact metadata. Model names describe their published size classes; both Qwen 1.5B variants have approximately 1.54 billion parameters.

All three use their embedded Jinja chat templates through the existing pinned llama.cpp runtime. Gemma 3 1B is text-only. The managed Provider now supports five chat targets without changing existing identities, weights, or selections. The existing 4,096-token context, 1,024-token output cap, private worker transport, serialized inference lease, Stop behavior, saved artifact provenance, and local-only admission rules apply to each target. No Web Research tools, database migration, or public API change is introduced.

The discovery catalog grows to 34 entries, eleven integrated for installation. Its default size limit becomes 1,500 MB so the new entries are visible without adjusting filters. The 500 MB filter remains available, alongside new 1 GB and 1.5 GB limits. File size is separate from parameter count and working memory. Installation remains explicit and does not select a model automatically. Explore-only entries retain their existing boundary.

Regression checks cover discovery visibility and size filtering, model-specific selection with draft preservation, independent installation/removal, publisher metadata, saved artifact snapshots, cancellation, and local-only admission. Native acceptance uses disposable data directories and the existing opt-in real-model gate; results and their limits belong in [local inference acceptance](../local-inference.md).
