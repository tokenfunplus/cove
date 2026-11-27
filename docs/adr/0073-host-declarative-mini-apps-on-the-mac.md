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
