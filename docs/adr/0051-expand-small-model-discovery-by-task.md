# Expand small-model discovery by task

Date: 2026-11-22

Status: Accepted

This extends [curated model discovery](0047-add-curated-local-model-discovery.md) while retaining the managed-install boundary in [ADR-0048](0048-add-managed-local-inference-and-document-retrieval.md).

The Local models catalog grows from seven to 27 entries across eleven tasks: document retrieval, reranking, writing, code, translation, OCR, transcription, speech synthesis, audio preparation, image tools, and text classification. Selected artifact sets remain within 500 MB. The catalog includes compact language identification and audio/vision utilities as well as several small chat-model families, rather than treating chat as the only local-model use.

Entries explicitly identify `Available in Cove` or `Explore only`. Only the existing BGE and Qwen2.5 0.5B registry entries have installers and enabled capabilities. Adding a discovery record does not download weights, enable inference, alter the Active Model Set, or register a tool. Explore-only entries require separate runtime integration and acceptance testing.

Discovery filters combine task, language, selected-file size, text search, and Cove integration. Language-independent and multilingual models are distinct choices. Size limits of 10, 50, 100, 250, and 500 MB help users find small utilities. Counts show the applicable result set, and reset clears every filter.

Presentation groups integrated entries before explore-only candidates. Compact task/language/size controls and explicit integration choices replace the large introductory panels. Integrated cards keep install/use actions visible, while removal stays in Installed. Explore-only rows disclose requirements and external links on demand and initially show six matches, with further groups revealed locally. Catalog order and ascending file-size order apply independently within the two integration groups. Filters, sort, and expanded results survive Installed/Discover switching while the settings panel remains mounted. No catalog request, new runtime integration, or download is implied by sorting or revealing results.

Typed metadata separates catalog records from filtering and presentation. Each card identifies selected files, runtime requirements, model license, original publisher, conversion provenance, and an immutable source revision where available. Multi-network and speech-synthesis selections include all listed networks or the selected voice vector in their displayed total. Supporting tokenizers, dictionaries, runtimes, working memory, and archive expansion remain separate.

Source checks use publisher model cards, model-hub file metadata, and maintainer download/license pages. Custom model terms are labeled explicitly; for example, LFM and SenseVoice are not labeled Apache-2.0 merely because a runtime uses that license. OPUS-MT's two translation directions retain their different declared licenses. Source review is not a compatibility or quality benchmark. See [catalog source notes](../local-model-catalog.md).
