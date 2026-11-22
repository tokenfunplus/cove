# Add curated local model discovery before runtime integration

Date: 2026-11-21

Status: Accepted

[ADR-0048](0048-add-managed-local-inference-and-document-retrieval.md) extends this decision for BGE Small Chinese and Qwen2.5 0.5B: those two entries now have managed downloads and native inference. The remaining entries retain the discovery-only behavior described below.

Settings includes a Local models discovery catalog organized by user task, language, and approximate weight size. Bundled metadata identifies the selected format and files, required runtime, publisher, license, source links, and limitations. Publisher repositories and community conversions are labeled separately. Metadata review does not imply tested runtime compatibility or measured performance.

The catalog is a frontend discovery surface, separate from the authenticated Provider model catalogs in [ADR-0034](0034-show-provider-model-catalog-details-and-local-brand-icons.md). It does not advertise installed models, change the Active Model Set, download weights, or enable a Generation or tool. Source links open external websites for manual inspection and downloads. Browsing and filtering perform no catalog network requests and persist no user content. ModelScope is an alternative hub to inspect, not an automatically interchangeable mirror.

Weight sizes cover only the listed weight files; tokenizers, configuration, runtime disk space, and working memory are separate. A future installer needs immutable revisions, complete artifact manifests, integrity checks, lifecycle management, and explicit runtime integration. That work remains owned by the Local Service, with Chat owning generation/tool orchestration and persistence owning durable records.
