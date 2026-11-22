# Add Qwen3 Abliterated as an independent local chat target

Date: 2026-11-22

Status: Accepted

This extends the single-chat-model integration in [ADR-0048](0048-add-managed-local-inference-and-document-retrieval.md), the discovery boundary in [ADR-0051](0051-expand-small-model-discovery-by-task.md), and explicit local selection in [ADR-0053](0053-integrate-local-capabilities-into-chat-and-projects.md).

Cove adds mlabonne's Qwen3 0.6B Abliterated Q5_K_M as the independent `qwen3-abliterated-chat` target. The existing `qwen-small-chat` identity and installed Qwen2.5 weights remain unchanged. The 444,415,104-byte GGUF is pinned to revision `92351f431cfdd36f71149aaf072a6490a68e144e` and SHA-256 `5f850d7369a02a318da85cf9b5deac9ab3f2f1cfe01f4ba48b68f6f7a72db87b`. The publisher declares Apache-2.0. Downloads remain explicit and integrity checked.

The managed Provider is configured when at least one registered chat model is installed and the native runtime is ready. Its catalog lists each installed chat target separately. Both Installed and Discover pass the selected model identity through Use in this chat; installation alone never changes the Active Model Set. The discovery catalog now has 28 records, three with managed installation.

Chat captures the selected target's artifact revision and hash in each immutable Provider Snapshot, independently of the shared Provider identity. Removing either chat model shares Generation admission, and cancellation stops the worker belonging to the selected target. Only on this Mac accepts either registered chat target, including retries; remote and embedding targets remain excluded. The existing single inference lease, idle unload, and persistence ownership remain unchanged. No database or public API schema change is required.

Qwen3 uses its embedded Jinja template with `enable_thinking=false`. It shares the 4,096-token context and 1,024-token output limits and does not expose Web Research tools. Reduced refusals do not establish improved accuracy or instruction following. The interface identifies the model as experimental and describes its abliterated behavior.

Regression checks cover independently installed models, correct Installed/Discover selection with draft preservation, model-specific cancellation and snapshots, removal admission, and local-only policy. The opt-in native acceptance gate supports an explicit `COVE_TEST_CHAT_MODEL`; synthetic Chinese smoke cases are not a general model-quality benchmark. See [local inference acceptance](../local-inference.md).
