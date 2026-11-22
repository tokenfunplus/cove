# Combine Projects and local-model storage migrations

Date: 2026-11-22

Status: Accepted

Syncing with main retains the Project schema-23 migration and schema-24 indexes from [ADR-0045](0045-add-projects-and-independent-context-snapshots.md). The local document library in [ADR-0048](0048-add-managed-local-inference-and-document-retrieval.md) moves to schema 25. It is added after the Project migrations in the same transaction, without changing Project input snapshots, source ownership, or conversation membership.

An unreleased local-model preview used schema 23 before Projects landed. Migration recognizes that specific shape: both local-library tables exist, all Project tables are absent, and the Project membership and Batch requirement columns are absent. Only that shape runs the missing Project migrations before migration 25. Existing library originals, vectors, and conversation history are retained. Mainline schema-23 Project databases follow their normal index migration instead. Failed migrations roll back transactionally.

Clearing chat data combines the established ownership rules: conversations, saved Batch snapshots, and the local document library are removed; live Projects and fixed Project Sources, installed model weights, settings, and credentials remain. The confirmation describes both removed and retained data. Regression checks exercise upgrades from mainline schema 24 and the local-only preview schema 23, alongside the existing mainline schema-23 and history-upgrade checks.

Unreleased local-model ADRs are numbered 0047 through 0051 after mainline's Project ADRs 0045 and 0046. Their references are updated without renumbering mainline decisions. This decision supersedes the preview's schema-23 assignment, not its data or lifecycle boundaries. Older services reject schema 25; preserve a compatible backup before upgrading if a downgrade is needed.
