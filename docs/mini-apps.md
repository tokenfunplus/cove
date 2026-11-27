# Develop a Cove Mini App

A Mini App is an installable package with its own data, actions and views.
The Japanese Review Book uses the same due-date query in the app and in Chat.
Reading Inbox uses a different rule that hides deferred and archived reading.
Both run through the same interpreter. The package file is UTF-8 JSON with the
extension `.coveapp`. It contains the full application definition and optional
example records. A fresh instance starts with its own copy of the examples.

## Build a personal app

The macOS package includes the author CLI at `/Applications/Cove.app/Contents/MacOS/coveapp`. The bundled `Contents/Resources/mini-apps` directory includes the schema, both reference packages and their test scenarios. To exercise an installed author kit:

```sh
kit=/Applications/Cove.app/Contents/Resources/mini-apps
/Applications/Cove.app/Contents/MacOS/coveapp test "$kit/examples/japanese-review-book.coveapp" "$kit/scenarios/japanese-review-book.json"
```

For development from source, build the author CLI from a Cove checkout with the Go toolchain listed in
[Development](development.md). Run the commands below from the repository root.

```sh
work=$(mktemp -d)
(cd services/local-service && ../../scripts/go build -o "$work/coveapp" ./cmd/coveapp)
"$work/coveapp" init my-studio field-notes "$work/notes.json"
"$work/coveapp" validate "$work/notes.json"
"$work/coveapp" preview "$work/notes.json"
"$work/coveapp" pack "$work/notes.json" "$work/field-notes.coveapp"
```

Edit the generated package in a JSON editor. Configure the editor to use the
[format 1 JSON Schema](../packages/api-contract/schemas/mini-app-v1.schema.json).
The installer and CLI additionally validate types across references, inferred
capabilities, byte quotas, migrations, and action-to-page bindings. Validation
checks the artifact structure. Installation also checks identities, immutable
versions and the selected origin. Reserve the publisher `cove` for official
packages. Choose a different publisher when creating a personal copy.

`preview` opens a new in-memory SQLite database, installs the app, and prints
its pages, actions and the results of zero-input page queries. `test` uses
the same isolated instance lifecycle to exercise a scenario. These commands use
only the test instance and never load the user's conversations or credentials.
Generate steps exercise the model input contract; model responses can be supplied
as fixture inputs to the subsequent create action. Use `preview SOURCE --browser` to open the actual app UI in an isolated
workspace. The options below cover fixture data and model simulation.

## Write the package

Start with the [minimal notes example](../services/local-service/cmd/coveapp/starter.coveapp).
The schema describes required fields and allowed keys. Keep three numbers distinct.

| Value | Purpose |
| --- | --- |
| `format` | Grammar version. This host implements integer `1`. |
| `version` | Release version with three nonnegative numeric components. Change it when package bytes change. |
| `schema_version` | Integer data model version. Increment it when an upgrade needs to migrate existing records. |

The `publisher` and `app` values are lowercase slugs, up to 48 characters,
beginning with a letter. Define between 1 and 16 collections, 1 and 64 named
actions, and 1 and 16 pages. A collection declares up to 40 fields, using
`text`, `bool`, `number` or `date`. Dates are ISO calendar dates
(`YYYY-MM-DD`). Declare a type for every input. Use an empty object for
actions without inputs. `seed` maps a collection to a list of full records.
The package limit is 1 MiB with up to 200 seed records across all collections.
The host allocates record IDs and revisions.

A page has an `id`, a `title`, and an ordered array of named actions. The
host builds controls for the actions and their input types. Put the main page
first. Each referenced action includes `page` in its `surfaces`. Include
`chat` and/or `panel` to expose the same operation from other surfaces.
Actions can also declare only `chat` or `panel`. They appear in the matching
picker and its model suggestions without requiring a page binding.

| Operation | Required capability | Declaration and behavior |
| --- | --- | --- |
| `query` | `records.query` | Choose a collection, optional `where` predicates, ascending `order_by` and a result `limit` of up to 200. Returns records with IDs, revisions and typed fields. |
| `create` | `records.commit` | Define a `values` assignment for every field. Saving a candidate is an explicit create action. |
| `update` | `records.commit` | Define `values` for the changed fields. The caller selects records and provides the expected revision for each. |
| `delete` | `records.commit` | Delete selected records after a preview and explicit confirmation. Optional `where` predicates constrain eligible records. The commit checks the selection revisions, rechecks the predicates and returns record IDs and revisions with empty fields. The host clears old replay payloads containing those records and retains their operation fingerprints. |
| `generate` | `ai.generate` | Supply a `prompt` and a `text_input` naming a text input. The user selects and approves the model destination. An optional `candidate_action` references a create action with the same or broader surface support. Candidate objects use the field names and types of that action's inputs. |

For generation, the named text input supplies the source passage. The host
sends any other declared inputs as a JSON object of named, typed parameters.
For example, an action can request a passage, a question count and a target
language. The model receives all three values reviewed by the user.

An uncapped query returns up to 50 records per request. Continue it by passing
the returned `next_cursor` as `cursor` with the same action, inputs and
surface. The host checks grants on every page. A change to records on an
earlier page can invalidate the cursor and require a fresh query. Equal sort
values retain creation order. An explicit `limit` caps the entire result.
The host's **Load more records** control preserves selections across pages;
up to 50 selected records can be attached or updated at once.

A query can name one field of its collection in `reveal_field`. The host
initially collapses that field in each result. For example, the Review Book
uses `"reveal_field": "answer"` on its daily practice query so users can
recall an answer before revealing it. The record and its selected snapshot
still contain all fields.

Each predicate declares a field, comparison and value. All predicates in
`where` must match. Comparisons include `eq`, `ne`, `lt`, `lte`,
`gt` and `gte`. Boolean predicates support equality and inequality.
Assignments and predicate values can be typed literals, a reference like
`$input.question`, or a date expression such as `$today`, `$today+7` or
`$today-1`. The expression type must match the field. Direct author strings
beginning with a dollar sign are reserved for expressions; text supplied by a
user through a typed input remains literal.

For example, the Review Book's `review.practiceAgain` updates selected
questions using the following rule.

```json
{
  "title": "Practice again tomorrow",
  "op": "update",
  "collection": "questions",
  "inputs": {},
  "surfaces": ["page", "chat", "panel"],
  "values": {"mastered": false, "due": "$today+1"}
}
```

Update assignments can read the previous record through `$record.<field>`.
An `add` expression accepts two numbers. Comparisons take two matching types
and produce a boolean. An `if` expression takes a boolean and two alternatives
of the same field type. A rule can nest these operations up to six levels.
All assignments see the same pre-update record. For example, a book with a
numeric `misses` field can count misses and adjust the next review date.

```json
{
  "misses": {"add": ["$record.misses", 1]},
  "due": {"if": [{"gte": ["$record.misses", 1]}, "$today+1", "$today+3"]}
}
```

## Request capabilities

Declare every capability used in `capabilities`. An instance needs a current
grant for each corresponding operation. File selection (`mac.files.pick`)
and selected text (`mac.selection.receive`) require user input. The Launcher
mediates native interaction. With `chat.attach`, the user can copy selected
records into a draft. The user controls which snapshot is submitted to the
model. The package receives neither browser session credentials nor Provider
Keys. A package can use user-selected text as model input with `ai.generate`.

The host identifies the instance for each invocation. It checks the actual
operation, the selected surface, and the instance grant. For a write, the first
invocation produces a preview. Accepting the preview repeats that same command
and operation ID with the confirmation token. A stale revision requires a
fresh read and preview. Replaying the same confirmed command applies it once.
Disabling an instance makes its actions unavailable. A canceled model job
does not add new records by itself.

## Test an app

Use the two complete packages and executable fixture scenarios as references.

```sh
packages=services/local-service/internal/appcatalog/packages
cases=packages/api-contract/fixtures/mini-apps
"$work/coveapp" test "$packages/japanese-review-book.coveapp" "$cases/japanese-review-book.json"
"$work/coveapp" test "$packages/reading-inbox.coveapp" "$cases/reading-inbox.json"
```

A scenario is a JSON object with a `steps` array. Each step names an `action`.
Optional fields include `surface`, `inputs`, `select` (zero-based indices
into the previous result), `count` (expected number of returned records) and
`expect_fields` (field values that must occur together in a returned record).
The runner previews then confirms each write and exits on the first failed
check. Run each scenario against a fresh instance.

- [Japanese Review Book](../services/local-service/internal/appcatalog/packages/japanese-review-book.coveapp) schedules learned items for next week, missed items for tomorrow, and uses selected model candidates as new cards. Its [scenario](../packages/api-contract/fixtures/mini-apps/japanese-review-book.json) checks that page, Chat and Quick Panel actions share the same book.
- [Reading Inbox](../services/local-service/internal/appcatalog/packages/reading-inbox.coveapp) combines the queue status and revisit date to calculate a reading list. Its [scenario](../packages/api-contract/fixtures/mini-apps/reading-inbox.json) defers one item and archives another.
  [Reading Inbox 1.1](../services/local-service/internal/appcatalog/packages/reading-inbox-1.1.coveapp)
  migrates existing entries with a deferral count of zero. Deferring a record
  reads its previous count, increments it, and sets a return date two days
  away on the first deferral or seven days away on subsequent deferrals.
  Restoring it resets the count. The package's `if`, `add`, and `$record`
  expressions implement these rules in the same host used for Review Book.
  Run the [Reading Inbox upgrade fixture](../packages/api-contract/fixtures/mini-apps/reading-inbox-upgrade.json)
  using the installed author kit:

  ```sh
  kit=/Applications/Cove.app/Contents/Resources/mini-apps
  /Applications/Cove.app/Contents/MacOS/coveapp upgrade-test \
    "$kit/examples/reading-inbox.coveapp" "$kit/examples/reading-inbox-1.1.coveapp" \
    "$kit/scenarios/reading-inbox-upgrade.json"
  ```



### Review Book 1.1 and compatible action options

Install the 1.1 release or upgrade an existing book in Settings. The schema
migration adds archive and source fields to each existing question. Open
Daily practice for a card-by-card session with an answer reveal and a confirmed
outcome. In the question library, edit a selected question and answer or archive
a card. The Archive view offers restore and permanent deletion with a preview.
Select saved material before generating questions to attach its record link to
the candidates. A linked card opens the material's current contents.

The package uses the following host contract extensions.

| Declaration | Behavior |
| --- | --- |
| Action `defaults` | Typed values for omitted inputs. A date input supports `$today` or a day offset. Extra keys and incorrect types are rejected. |
| Query `limit_input` | Names a numeric input accepting a whole number from 1 through 200. `review.listDue` accepts `{"date":"2026-11-27","limit":3}`. |
| Generate `count_input` | Names a numeric input accepting a whole number from 1 through 8. The reviewed parameter enters the prompt. The model picker checks the count before offering the candidates for saving. |
| Action `selection_inputs` | Maps inputs to fields from one selected record of the declared collection. Use `$id` for the record identity. |
| Generate `candidate_bindings` | Maps create-action input names to host-copied generate inputs. These values are drawn from the frozen task input when saving candidates. The model supplies the other fields. |
| Collection `links` | Maps a reference field to a display-label field and a named lookup query. The query takes a single text input `id` and compares the scoped record's `$id` to `$input.id`. |
| Page `practice` | Declares a query, two text fields to reveal in succession and one to four named update actions for scoring each record. The browser keeps the session's original record revisions through confirmation. |

## Release an update

Keep the publisher and app ID stable. Personal file imports upgrade through
local releases. The configured catalog signer can update bundled apps from any
publisher, including Reading Inbox. Change the release
version when changing a rule, view or label. To add a new field to existing
records, declare it in the collection, update all applicable create actions
and seed records, increment `schema_version`, and supply a migration for each
schema transition. For example, a new boolean field can have this migration.

```json
{"from": 1, "to": 2, "defaults": {"items": {"starred": false}}}
```

Exercise an upgrade with an existing user record as well as a fresh install.
The instance switches releases with its record changes in one transaction.
Each instance has its own active release and grants. Sharing the package shares
the definition and its bundled examples. Keep personal records out of seed data.

## Back up an instance

Export data from the instance management screen to save a plaintext
`.covedata` file. It includes the records in every collection, their IDs and
revisions, and the identity and digest of the installed release. Text imported
from files appears in the backup when it was saved as a record. Keep the backup
private. Retain a copy of the matching package or access to its catalog release.

Restoring a backup requires the original publisher, app, version and content
digest. For an official release, either the bundle or the signed catalog can
supply those exact bytes. A personal import requires the same personal package. Cove
validates the complete record set and creates a separate disabled instance.
Enable the restored instance and choose its grants to use it. Running tasks,
temporary file-picker results, chat history, model configuration, and grants stay
outside the data backup. A failed restore rolls back the new instance.

## Local processing in text fields

An instance with `documents.search` can offer **Find a document excerpt** in
its text fields. The host lets the user choose one to four documents from the
local library and search up to 400 characters using the installed embedding
model. The user chooses a specific result before its text enters the field.
Use in a model request or saved record follows the ordinary action flow.

An instance with `speech.speak` can offer **Read this text aloud** for a
nonempty field of up to 6,000 characters. English and Chinese use the saved local
voice configuration. Japanese uses an installed macOS Japanese voice on this Mac.
Declare `speech_language: "ja"` to offer **Read in Japanese** on practice cards
and select Japanese for kanji-only passages in text fields. Kana selects Japanese
automatically. With the current permission, a client may POST `text` and
`language: "ja"` to the instance speech endpoint. Voice discovery and synthesis
run locally. A Mac without an installed Japanese voice reports it before creating
a job. The temporary WAV, cancellation and session ownership follow the existing
speech path. Playback uses temporary
audio scoped to the instance and browser session. Changing grants, disabling
the instance or deleting it stops outstanding readings for that instance.

## Instance attachments

Declare `blobs.import` to expose the host file library on the app page. Users can import and download a named attachment, or confirm its removal. Each attachment has an opaque UUID scoped to its instance. The authenticated instance API lists metadata at `GET /api/mini-apps/instances/{id}/blobs`; uploading sends raw bytes with an operation UUID and filename as query parameters. Reusing an ID with identical content and name is idempotent. Reading or deleting an attachment requires the same instance and current grant. The host accepts up to 64 files and 16 MiB per instance, with a maximum of 4 MiB per file. Personal instance backups retain attachment IDs, names and bytes alongside records. The installer accepts package definitions independently of these backups.

## Let a model propose an action

In Chat or Quick Panel, choose an instance and open **Ask a model to propose an
action**. Select the permitted operations, enter a question and review the model
destination. The request contains that question and the selected action names,
titles, effects and input schemas. Models advertising tool support receive
function definitions. Other compatible targets can return the same proposal as
JSON. Cove validates the selected action and all input fields, then lets the user
open the ordinary action form and edit the values. Picking records, confirming a
write and transferring results into Chat each use the normal host controls.

### Verified NearAI model tasks

With **Only on this Mac** cleared, a generate action can offer a configured
NearAI model. The initiating authenticated browser claims the task once and
runs Cove's existing NearAI verification transport on the host-frozen input.
Keep the initiating browser tab open while the task runs. Closing the form or navigating inside the workspace keeps the verification worker running. A temporary status polling failure can be retried independently. The instance saves the resolved
Provider Snapshot, verified answer and receipt. Private TEE requires model
verification. Incognito and Chutes require gateway verification. A rejected
receipt or an expired browser task produces a failed result with no candidate
text. Later sessions can read the saved receipt in the model result.

For a create action, an invocation may supply `items` with one to fifty complete input objects and an empty `inputs` object. One preview covers all proposed records. Confirming it commits the entire batch with one operation ID. The candidate picker uses this operation to save multiple model suggestions together.

## Rehearse an upgrade

Use the exact old and new packages and a JSON fixture. For the bundled Review Book:

```sh
kit=/Applications/Cove.app/Contents/Resources/mini-apps
cli=/Applications/Cove.app/Contents/MacOS/coveapp
"$cli" upgrade-test "$kit/examples/japanese-review-book.coveapp" \
  "$kit/examples/japanese-review-book-1.1.coveapp" \
  "$kit/scenarios/japanese-review-upgrade.json"
```

The [upgrade fixture](../packages/api-contract/fixtures/mini-apps/japanese-review-upgrade.json)
shows the supported fields. `before` and `after` accept the same action steps
and assertions as `test`. Selections refer to the preceding step within the
same phase. Declare the previous user's `grants` explicitly to test a limited
installation. Omitting the field grants the old package's declared capabilities
in the disposable instance. An empty array means the user granted none.
Fixtures may include attachments with a filename and base64-encoded `data`
when the old instance has the `blobs.import` grant.

The CLI installs the old release, runs the sample actions, then uses the
production upgrade operation on that instance. It checks instance identity,
the active release, and retention of still-declared grants. It compares
record counts, IDs and existing field values in each previous collection,
and checks every attachment's ID, name and bytes. An unchanged record keeps
its revision. A migrated record must have a newer revision. Assert new
defaults or business rules with `expect_fields` and `count` in `after`.
A migration or assertion failure exits with a nonzero status.

## Preview in a browser

```sh
"$cli" preview "$kit/examples/japanese-review-book.coveapp" --browser
"$cli" preview my-reading.coveapp --browser --fixture reading-preview.json --allow blobs.import
"$cli" preview study.coveapp --browser --model-endpoint http://127.0.0.1:8080/v1
```

The CLI opens the production browser UI on an ephemeral loopback port. The
workspace uses an in-memory database and an in-memory credential store.
Closing the CLI with Ctrl-C discards the instance, fixtures, and its grants.
Both browser preview and `upgrade-test` recognize bundled examples by their
exact bytes. Use your own publisher when adapting an example. Preview your
personal package, then open **My apps** and import a newer file from that
publisher to practice upgrading the same instance.
For a CLI built from source, run `make build-web` before building `coveapp`.

A browser fixture accepts `steps` to populate sample records and an optional
`model_response` string for simulated generation. To preview candidate
selection, supply a response in the format expected by your package. Select
**Simulated author model** and **fixture-model** after clearing **Only on this
Mac** in the model form. The simulated response is generated inside the CLI.
Use the preview for app-owned generation tasks and selecting records for a
Chat draft. To submit a normal conversation turn that can choose app actions,
install the package in Cove.

Use `--allow blobs.import` to try importing a real attachment into the preview.
An explicit `--model-endpoint` replaces the simulated model with the indicated
OpenAI-compatible loopback service. It must support unauthenticated access and
the package must declare `ai.generate`. Choose the model in the preview and
review the selected input before running it. The workspace has no connection to
the installed Cove Launcher, model weights, or existing Provider Profiles.

## Use an app in a conversation turn

Open **Tools → Mini Apps**, choose an instance and expand **Use app actions in my next message**.
Select the actions the chat model may propose and click **Use in next message**.
The composer displays the app and number of selected actions. Enter the request in
the ordinary chat composer and send it. This scope applies to one turn. A subsequent
message can discuss selected results, or you can choose app actions for another turn.

Cove checks the instance revision, release, surface and grants. The model receives
only the selected action definitions alongside the ordinary conversation context.
One compatible model or Cove-managed local model can propose a function call or a
JSON action. Verified NearAI uses the existing signed-response transport with JSON proposals. Cove validates the saved response and its verification status before displaying controls. Model comparisons and Web search support
manual app actions through the picker. The host validates proposals before
publishing them. Opening a read response queries the instance locally. Use **Add to
current draft** to share selected fields and choose when to send. Local source
bookmarks, record identities and revisions stay out of the model input.

Write responses preview the proposed changes and require confirmation. A generate
response presents the app's task form after the conversation turn finishes. Review
the input and destination and choose **Start model task**. The app owns the new
task, its cancellation and candidate results. Changing an instance's grants or
release retires replies that refer to the earlier revision.

## Permissions, native selections and history

New instances start with all permissions unchecked. The install preview lists compatible existing instances with the installed and incoming versions. A single matching instance is preselected for upgrade. With multiple matches, choose one explicitly. Creating a separate instance starts with independent data. Upgrades retain existing grants and ask for each newly requested capability.

Use **Services → Send to Cove Mini App** in a Mac application to choose an enabled instance, action and field for selected text. The Launcher deposits the selection over its control channel. The receiving page offers a one-use import into that field before the user runs the action. Selections expire after ten minutes; a permission change invalidates them. **Ask Cove** continues to open the Quick Panel. A pending file request expires after two minutes; the Launcher renews its thirty-minute lease while the native picker remains open.

`GET /api/mini-apps/instances/{id}/capabilities` reports the host contract version and a per-capability state of `available`, `setup_required`, `denied` or `unsupported`. Query with `local_only=true` for a managed-model task. This performs local readiness checks without running a model, installing weights or prompting for a file. The actual operation validates its specific target, inputs and grant again.

The `min_host_version` field names the minimum Mini App runtime release. An action's `output_schema` names its result kind and typed fields. The validator checks it against the collection or candidate action. Packages may bundle up to eight PNG or JPEG images under `assets`, keyed by slug and containing `mime`, `alt` and base64 `data`. Use `image` on a page to reference one. The host and directory display these images with a limit of 256 KiB and 2,048 pixels per side per image.

Instance settings show recent actions with their caller surface and outcome. The host keeps up to 100 activity entries for seven days. Confirmed writes retain the newest 64 full results and completed model tasks retain the newest 30 payloads, each subject to a seven-day lifetime and a 4 MiB payload budget per instance per category. Small operation fingerprints remain to prevent replayed writes and model charges. Saved records and user-imported attachments have their own lifecycle. Closing the app or retiring diagnostic history preserves them.

Highlight a passage in a saved chat message and choose **Use selected text in an
app**. Select an instance and text field, then choose **Use selected chat text**.
The host checks its selection grant before copying the frozen passage into the
field. The original chat draft is preserved.
