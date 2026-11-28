# Host declarative Mini Apps on the Mac

Date: 2026-11-27

Cove accepts versioned, data-only JSON packages that declare typed collections,
bounded named operations, and pages containing those operations. The browser
renders trusted controls. The Go host resolves package expressions and derives
the effects of each operation. A package author can define application rules
using these primitives and test them against the production interpreter in an
ephemeral workspace. The first contract supports Japanese Review Book and
Reading Inbox. Extending this grammar requires versioned compatibility and
conformance fixtures for both apps.

A release identifies immutable package bytes within an origin, publisher, app
and version. An instance owns the active release reference, records, grants and
local identity. Each instance upgrades independently. Authoring, viewing and
installing packages are separate from allowing an instance to access a Mac
selection or send user input to a model. A deep link conveys navigation intent.
The authenticated Local Service resolves the target and enforces grants.

The bundle and the configured signed catalog share a release authority.
When restoring a personal instance backup, either channel can supply the
exact official package recorded in the backup. Restoration verifies its
publisher, app, version and SHA-256 digest. A locally imported release
retains its separate identity.

This extends the existing boundaries in [ADR 0012](0012-make-chat-the-local-service-application-facade.md)
and [ADR 0063](0063-add-json-interactive-chat-cards.md). Chat owns model
execution and access to Provider credentials. A Mini App owns the requests it
initiates and their results. Chat owns snapshots explicitly brought into a
conversation. Removing that conversation preserves the originating App instance.
The existing commitments for [local model policy](0053-integrate-local-capabilities-into-chat-and-projects.md)
and [native selection](0061-import-macos-content-into-quick-panel-drafts.md)
also apply when requests originate in a Mini App.

The public [authoring contract](../mini-apps.md) describes the release format,
author tools and executable example scenarios.

Visual Studio Code registers commands and views through JSON declarations in
its extension manifest. This provided a reference for referencing one named
operation from several host surfaces. Cove's interpreter implements the
package operations and applies instance grants. See the
[VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points).

SQLite schema 30 adds Mini App releases, instances, typed records, attachment
blobs, write receipts and model tasks. Migration from schema 29 is additive.
Existing Conversations, Projects, interactive cards and Provider Profiles
retain their owners. Older services reject schema 30. Package schema versions
advance independently inside individual instances. The first package format
supports additive migrations with defaults; an incompatible migration rolls
back its record changes and keeps the previous release active.

The NearAI browser remains responsible for SDK verification when a Mini App
starts a generate task. A single claim belongs to the initiating Browser
Session. Settlement validates the receipt for the frozen target's privacy
mode and saves it with the instance-owned task. Loss of the browser expires
the task without exposing partial output. Both verified and ordinary model
tasks use Chat's shared active-work admission.

## Runtime 1.1

The user can scope a normal conversation turn to named actions of one instance. The Generation configuration stores the authorized release and revision. The host checks them again before invoking the proposed action. Query results remain local until selected. Writes use a separate reviewed confirmation. An app-owned model task can start after the conversation releases its execution slot.

Cove distinguishes runtime version, immutable package release, collection schema version and record revision. A downloaded file can reuse a trusted release when its exact digest matches the verified source. The signed catalog format adds expiry and a persistent per-key sequence checkpoint. Bundled releases remain available when remote verification fails. Finder-launched sessions can use packaged public trust settings or explicitly configured local preferences.

SQLite schema 31 adds the conversation action scope and bounded, per-instance task and receipt history. Compact idempotency fingerprints outlive the stored result, while instance-owned records and attachments are retained. Older services reject this database version. Package migrations remain independent of the host database version.

## Review follow-up

An exact bundled digest can attest a legacy local file release for a reviewed
upgrade to a trusted successor. This exception does not authorize modified
personal bytes or changes based on publisher name alone. Existing instance
identity and user records survive this transition.

Verified Mini App settlements store a receipt in the task's existing request
metadata. The receipt binds the exact response, browser session and claim.
Delivery retries are idempotent after acceptance and do not repeat inference.
This adds no host database migration. Record editors bind their target selection
when opened, and cross-workspace navigation uses Chat's draft confirmation.

## Directory authority and cloud policy

Only a catalog verified by the public key embedded in the Cove release can
supply updates for bundled publisher identities. A user-selected signing key
has an independent authority. Changing it requires explicit confirmation bound
to the previously displayed URL and key, and each key retains its own rollback
checkpoint. Official key rotation therefore requires a Cove release carrying
the new default key followed by confirmation for a saved directory configuration.
This supersedes the initial shared-authority statement above.

SQLite schema 32 adds a per-instance cloud permission with a default of false.
Existing records, attachments and local generation grants retain their values.
The setting controls app-owned remote tasks independently of local generation.
Query invocations no longer write activity rows, preserving room for reviewed
writes and model-task lifecycle entries. The workspace can inspect activity and
remove only package releases that have no instance references.

Model-task admission, terminal state, browser settlement receipts and activity
changes commit in one persistence transaction. Activity failure cannot leave a
running task without its worker or acknowledge only part of a verified result.
Restart recovery updates task and activity states together.

## Directory preference modes and scoped histories

An unset directory override follows the public URL and key packaged with the
installed Cove version. Saving those exact configured defaults preserves that
mode. A custom directory remains pinned across Cove updates; an explicitly empty
selection stays bundled-only. Settings exposes the packaged defaults and a
separate, confirmed action to restore default tracking.

Release-version and publisher histories are scoped to the signing key, just like
rollback checkpoints. Switching authorities cannot transfer a conflicting version
history to another signer. Returning to an authority still enforces its prior
sequence and immutable releases. Legacy histories with exactly one attributable
signer retain their version history; ambiguous multi-signer histories are
reverified while their rollback checkpoints remain intact. This refines the
initial directory authority policy without changing installed instance data.

Conversation interception requires an available app and explicit `@Name` for a
named app. Discovery shortcuts stay local and preserve an existing draft.
Candidate validation reports individual invalid rows so valid selections remain
usable; committed batches retain their all-or-nothing validation. Debate retries
transient delivery of a frozen verified result without claiming or charging a
second inference, and never replaces it with an empty failure receipt.

## Author drafts and task settlement recovery

Structural draft validation is separate from installation authority. The editor
may validate an unpublished package from a known publisher, but receives no
release identity or verified-origin attestation and cannot access live records.
Public package previews are validated before their original bytes are returned.

Chat retries a frozen App task settlement without repeating inference. If storage
remains unavailable, one pending settlement stays in service memory and blocks
additional App model work while ordinary Chat continues. An authenticated owner
can retry persistence without receiving data or restoring execution grants; an
explicit instance deletion removes that instance's pending settlement. Accepted
verified browser receipts remain idempotent. Restart cannot recover an unsaved
in-memory output and never automatically repeats the paid request.


## Explicit unsaved-result recovery

An owner may confirm discarding one unsaved model output. Chat first stores a
cancelled terminal state with no output, then releases admission for other App
tasks. If cancellation cannot be stored, the original output remains recoverable.
An already committed answer is never replaced by a late discard. Recovery remains
available after generation permission is revoked and does not remove records,
attachments, or the instance. Activity names the blocking app and offers a direct,
draft-protected navigation path from Chat.

## Per-release catalog signer continuity

A verified catalog release now persists the SHA-256 fingerprint of its Ed25519
public key as part of its immutable release identity and storage provenance.
Public responses retain the `catalog` channel and separately expose the signing
authority and whether it matches the packaged Cove default key. Catalog updates
must retain that fingerprint, even after a confirmed directory-authority switch.
Only the packaged official authority can succeed a bundled identity. This
supersedes the earlier policy that a newly selected catalog authority could
update every non-bundled publisher identity.

Existing unbound catalog releases retain their records, attachments and normal
use, but cannot acquire an inferred signer through an upgrade. Their exact bytes
can be independently reverified and used when restoring an exported backup as a
separate disabled instance; permissions must be granted again. Key transfer or
rotation for an already bound catalog lineage needs a future explicit identity
transfer contract. This change uses the existing provenance column, without a
host database schema migration.

Directory failures cache only bundled fallback metadata and the original warning
for five seconds. Cancelled requests do not populate that cache, and any trust or
URL change invalidates it. Legacy immutable-version history is attributed to its
sole historical signer even when a different, unverified key is currently selected;
ambiguous multi-signer history still requires independent reverification.

Legacy public-key encodings are canonicalized before trust-history lookup. When
aliases identify the same Ed25519 key, their highest sequence is retained. Equal
sequence/index conflicts and immutable package conflicts remain closed until an
unambiguous newer index omits the conflicted version; neither alias is arbitrarily
accepted. New settings require canonical base64, preventing new history aliases.


## Workspace navigation and draft protection

First-party workspace entries carry a namespaced lineage, index, and key while
preserving other browser history state. Programmatic navigation requests Chat's
existing draft and generation confirmation before adding an entry. A protected
Back or Forward traversal returns to the known original entry; approval revisits
the existing target instead of replacing its URL. Staying leaves those tracked
entries intact. Native fragment entries retain the current lineage with their own
index and key, including when Chat consumes the fragment. Back and Forward reuse
those positions rather than rebasing them. Moving to a different history entry
invalidates pending approval even when its URL is unchanged. Legacy and external
entries have no safe numeric traversal distance; their fallback preserves the
current Chat URL and state rather than guessing into unrelated history.

An App snapshot handoff belongs to its initiating workspace navigation attempt.
If the owner navigates away while a conversation is being created, completion
does not replace the current destination or its draft.

The release-authority encoding does not add a database schema migration beyond
this branch's schema 32. The main-branch service rejects that newer schema. Earlier
unreleased schema-32 development builds do not implement the new signer binding;
downgrading Mini App data to those development snapshots is unsupported.

## Review-bound installation and deterministic package upgrades

Installation binds the exact reviewed bytes and release authority. Catalog
confirmation includes the reviewed signing fingerprint, and file confirmation
includes the previewed release identity and digest. Concurrent trust changes
require a new preview instead of installing under a different authority.

Skipped additive migration steps materialize the first default for each new
field, matching sequential upgrades. Later additive defaults do not overwrite
that stored value. Record size and instance quota checks run before migrated
record writes, within the existing atomic upgrade transaction. Date defaults
use civil calendar arithmetic, so DST changes cannot shift a reviewed date.

Where the browser exposes synchronous Navigation API entry-change events, native
fragment pushes receive their history identity at commit, including rapid pushes
whose ordinary hash events arrive together. Without those events, only a bounded
contiguous fragment chain with a proven distance retains its prior lineage.
An unproven fragment gets an independent scroll identity; it does not acquire
a guessed position in the older lineage. If declining a protected traversal
requires crossing that boundary, Cove returns to the retained known Chat origin
while preserving the Apps destination and intervening entries. This can restore
the known Chat URL rather than an unproven intermediate fragment. External
entries without a known origin retain the conservative legacy fallback.
The known origin is a compact, validated same-origin Chat URL and entry identity
in the fragment metadata, propagated to derived entries so a reload does not
erase that fallback. It does not contain a nested history-state snapshot, draft,
session token or app data.

A superseding browser traversal releases the obsolete restoration waiter and
invalidates its pending approval. The actual entry is then handled as a fresh
navigation using its own tracked position, without replacing history entries.
