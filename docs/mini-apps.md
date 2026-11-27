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
as fixture inputs to the subsequent create action. To try the actual UI, import
the packed file in Mini Apps and create a disposable instance.

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

| Operation | Required capability | Declaration and behavior |
| --- | --- | --- |
| `query` | `records.query` | Choose a collection, optional `where` predicates, ascending `order_by` and a result `limit` of up to 200. Returns records with IDs, revisions and typed fields. |
| `create` | `records.commit` | Define a `values` assignment for every field. Saving a candidate is an explicit create action. |
| `update` | `records.commit` | Define `values` for the changed fields. The caller selects records and provides the expected revision for each. |
| `generate` | `ai.generate` | Supply a `prompt` and a `text_input` naming a text input. The user selects and approves the model destination. An optional `candidate_action` references a create action with the same or broader surface support. Candidate objects use the field names and types of that action's inputs. |

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

Restoring a backup requires that exact release from the same origin. Cove
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
nonempty field of up to 6,000 characters. The selected local voice configuration
governs supported languages. The existing speech registry supports English and
Chinese. Install a compatible model through Discover. Playback uses temporary
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
Keep the view open while the task runs. The instance saves the resolved
Provider Snapshot, verified answer and receipt. Private TEE requires model
verification. Incognito and Chutes require gateway verification. A rejected
receipt or an expired browser task produces a failed result with no candidate
text. Later sessions can read the saved receipt in the model result.

For a create action, an invocation may supply `items` with one to fifty complete input objects and an empty `inputs` object. One preview covers all proposed records. Confirming it commits the entire batch with one operation ID. The candidate picker uses this operation to save multiple model suggestions together.
