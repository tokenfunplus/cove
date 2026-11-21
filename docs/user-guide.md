# Using Cove

For continuous multi-model discussions, see [Debate mode](debate.md).

Cove is a local-first AI chat application for Apple Silicon Macs running macOS 13 or later. Its menu-bar Launcher starts a Local Service and opens the Chat Surface in your browser. The interface is English; messages, titles, and prompts support Unicode content.

This guide follows the current source tree, including unreleased features. The published Beta 8 package follows its [release notes](releases/0.1.0-beta.8.md); see the [unreleased changelog](../CHANGELOG.md#unreleased) for newer changes.

## Install and upgrade

Download [0.1.0-beta.8](https://github.com/tokenfunplus/cove/releases/tag/v0.1.0-beta.8), open the DMG, and drag Cove to Applications. A checksum file accompanies each download; check the release page for the package's Apple signing and notarization status.

For an upgrade, quit Cove from its menu-bar menu before replacing the app. Existing Cove history and settings remain in the local data directory. Provider Keys remain in macOS Keychain. Under Check for Updates, Check Stable Releases follows the stable channel; Check Beta Releases explicitly checks for newer betas, release candidates, or final versions. Builds before beta.4 can download beta updates from GitHub Releases.

The Launcher menu offers Open Chat, New Chat, and Settings. When no Provider is configured, Set Up Provider opens Provider settings directly. Launcher Settings contains the optional Launch at Login and global Control-Option-Space shortcut; macOS may require approval for a login item. Login launches stay in the menu bar without opening the browser. Manual launches and reopening Cove open Chat. If the Local Service fails, choose Retry and Open Chat.

Troubleshooting contains Restart Local Service, Open Data Folder, and Copy Diagnostics. The diagnostic summary excludes credentials, launch URLs, errors, and conversations. Check for Updates groups stable and explicit beta checks. After a newer release is found, the menu displays Update Available and keeps its download link available after dismissing the alert. About Cove contains the installed version/build and a Release Notes link for that exact version, including beta releases. Help & Feedback opens the user guide or issue tracker without submitting a report.

## Connect a Provider

Open **Settings → Provider settings**, choose a Provider, enter its API key, click **Test connection**, choose a model target for initial setup, then click **Save Provider**. A connection test alone does not save the key or profile. Provider Profiles describe connections; model targets belong to the Active Model Set. Setup initializes the chosen target only when no targets are selected. Saving Provider edits leaves an existing set unchanged; use the workspace's model controls to change its targets.

Custom Providers use OpenAI-compatible APIs and require HTTPS, except for loopback HTTP endpoints. The NearAI preset has a fixed staging endpoint; its availability and model catalog depend on that service.

See the [configuration reference](configuration.md#provider-profiles) for connection fields, generation parameter ranges and defaults, and local storage options.

macOS may request permission when Cove first reads an existing Provider Key or when its signing identity changes. Authorized keys are reused within the running Local Service. Catalog errors do not automatically retry on focus or reconnect. After granting access, use the explicit connection test to recover the catalog. Restart Cove after changing an existing key outside the running service.

## Chat and compare models

Choose one model for an ordinary conversation, or up to four targets for a comparison. Each answer retains its Provider Snapshot and available verification evidence. Select the answer you want to include in the next turn's context, or continue without an answer from that turn.

A submitted turn captures its context. Retrying a target uses that same saved context and attached source input. Later changes to an earlier answer selection do not rewrite a turn already submitted.

Provider-supplied reasoning appears in a **Reasoning** section above the answer. It starts expanded while text is streaming and automatically collapses when streaming ends, including while a private response is being verified. Saved answers start collapsed. Click **Reasoning** to expand or collapse it manually. Structured reasoning is saved locally and included in exports, separately from the answer; later turns send only the selected answer body. Responses beginning with explicit `<think>`, `<reasoning>`, or `<analysis>` blocks also support folding, while retaining their original body and context. Previously saved prose without reasoning boundaries cannot be separated automatically.

Model selectors include locally bundled brand icons, model names and identifiers, and available Provider catalog details: input/output USD prices per million tokens, context/output limits, and capability labels. Search by model ID, name, publisher, or capability. Missing details remain unavailable. These are Provider-advertised capabilities; Cove currently sends text and extracted document text. Catalog prices are indicative and do not change your manually configured Generation cost estimates.

### Read mathematical notation

Assistant answers render inline math with `$...$` or `\(...\)`, and multiline display math with `$$...$$` or `\[...\]`. Long equations scroll horizontally inside the answer, including Model Comparison columns. Formula rendering and fonts work locally. Code, escaped delimiters, and ordinary currency stay literal; incomplete or unsupported formulas show readable source. Copying and exports retain the original LaTeX.

Prefer `\(...\)` when dollar signs are ambiguous with currency. Common notation includes fractions, Greek letters, vectors, matrices, and aligned equations. Formula rendering does not contact a Provider or a remote typesetting service.

### Faster model selection and reading

Use the star beside the Model label to favorite the current model. Favorites and recently selected models appear first. The filter button narrows the catalog by capability, minimum context, and maximum input/output USD price per million tokens. Missing Provider details do not pass the corresponding filter. The filter menus use the workspace theme. Escape closes an open option list before closing the filter panel. Clear filters to return to the full list. In Model comparison, name and save a combination to restore its entire model set with one click. Favorites, recent selections, and named combinations stay in this browser profile; storage restrictions can limit them to the current session.

Assistant headers show model identity and a short verification status. Open **Response details** for performance, Provider/Privacy information, and full verification reports. Verification problems remain visible before opening it.

Scrolling upward pauses following new responses. **Jump to latest** shows the number of answers updated while you were reading. Reasoning folds and stream layout changes preserve the current reading block where it remains available. Returning to the latest response or sending a new prompt resumes following.

### Follow up on a passage

Select up to 8,000 characters in a saved assistant answer to open **Explain**, **Give an example**, or **Ask about selection**. The action opens a side panel with a quoted passage and editable question; click **Send question** to contact your active models. **Ask about this** below an answer opens the same tool with its text (or an excerpt for longer answers).

The side question uses your active models, System Prompt, and generation settings. It starts a separate saved conversation with only the quoted passage, question, and source model identifier. It does not inherit or change the main conversation. Later questions use the separate side history; comparisons still need an answer selection or an explicit context skip before continuing. Side conversations remain available in local history. The main conversation and answer tools share Cove's one-active-Batch limit.

### Edit an answer in the workbench

Click **Edit in workbench** below a saved answer. Edit the copy directly, switch between **Edit**, **Preview**, and **Changes**, undo/redo, copy it, or download Markdown. The original answer, Provider context, and verification evidence remain unchanged.

Enter a **Revision request** to ask your active models to revise the draft. Select text in the editor to rewrite only that passage, or choose **Use whole draft**. The current draft and editing request are sent using your existing Provider transport. Review the proposed changes and click **Apply revision** to accept a model's result. A proposal cannot replace newer local edits made after its request.

Working drafts and up to 20 undo steps stay in this window's memory, including while the panel is closed. Download to retain a copy across reloads. Cove asks before replacing a changed draft and uses the browser's refresh/close protection where supported. Drafts are limited to 120,000 browser text units; supplementary Unicode characters count as two units. Revision requests and responses are saved as separate local conversations. Use **Answer tools** above the conversation to reopen the panel.

### Edit a prompt and branch

Click **Edit and resend** on a saved user message, edit the prompt, and choose which of your active models to run. **Send in new branch** creates a separate conversation with the saved context and exact attachments from that turn. It excludes the original answer and later messages; current System Prompt and generation settings apply. Earlier messages in the branch are independent copies, with verification evidence belonging to the original responses. The original conversation remains available. Sending or clearing your current unsent draft is required before editing another prompt.

### Wait and recover

During generation, Cove shows elapsed time and the current stage. A prolonged quiet period offers stopping the attempt. Failure controls can retry the original target, choose a model for a future submission, edit/resend in a branch, or open Provider settings. Selecting a different model does not alter the model used by an ordinary retry.

### Response performance

Open **Response details** below an answer to inspect total time, time to first text, input/output tokens, and output speed. Counts come from the Provider. Missing counts and older measurements are shown as unavailable. Private inference timings are measured in the browser and total time includes verification. Output speed uses the interval between first and last text chunks, so very short or buffered responses may have no useful speed measurement.

Optionally enter your Provider/model's input and output rates in USD per million tokens. Estimated cost uses those current rates and reported counts, excluding Provider-specific cache discounts and other charges. Rates stay in this browser; no pricing lookup or additional inference request is made.

### Focus and timeline bookmarks

Click the four-corner button beside Model comparison to enter Focus. It hides the sidebar, compacts the header and composer, and gives replies more room. Exit Focus or press Escape to restore the previous layout. Escape closes an open preview or dialog first. Drafts, attachments, model selections, and active responses are preserved. Command-K or Control-K leaves Focus and opens conversation search.

The slim timeline on the right has one marker per user turn; the longer, darker marker follows your reading position. Hover or keyboard-focus a marker to preview its prompt and a short answer excerpt. Move into the card to save or remove a bookmark, or click a marker to jump to that turn. The card stays open while moving between the marker and its controls. On touch screens, tap a marker to open its preview and navigate.

Bookmarks save conversation/message identifiers only in this browser profile for the Local Service address. They survive reloads but are not included in database backups or conversation exports. Clearing browser data removes them. If storage is unavailable, the card reports that changes last for the current session only. Previewing and bookmarking do not contact a Provider or change later conversation context.

## Filter history

![History filter menu with synthetic conversations](images/history-filters.png)

Use the filter button beside **History** below the sidebar search field. **Last activity** offers All time, Today, Last 7 days, and Last 30 days; **Conversation type** offers All types, Chat, and Debate. Dates follow your local timezone and include today. Filters combine with search and the archive view. The toolbar shows the matching count and removable filter chips; **Reset filters** returns to the full list. Filtering preserves the conversation and draft already open.

Only the two filter choices are remembered in this browser profile for the Local Service address. Search phrases and conversation content are not stored with those preferences. Activity uses the conversation's existing update time, including completed model responses and Debate updates.

Debates show Running, Pausing, Paused, or Stopped and their current round. State labels reconcile with the Local Service while the page is open. Reading or filtering history does not start Provider work. Debate body search remains limited to its title; ordinary Chat search also matches locally saved user/assistant text.

## Read webpages

Click **Read webpage** beside the attachment button. A URL already present in your message is offered in the dialog; you can also enter a public HTTP or HTTPS URL. Click **Read webpage** to contact that website and extract its readable text. Preview the source, enter your question, and send. The preview shows the final URL and read time. Answer citations open the saved source lines, with an option to open the original website.

Webpages and files share the four-source count and character limits below. A webpage response is limited to 4 MiB and fifteen seconds. Previews expire after fifteen minutes; remove an expired source and read it again. Removing a loading source cancels its request. Sources stay with your unsent draft and are discarded on confirmed navigation or reload.

The reader supports HTML and plain text available from a public URL. Pages requiring JavaScript, authentication, or access through a private network can fail. Failure details appear on the source card. Extracted text is sent to the selected Providers when you send the question. Original page bytes, source URLs, and text are saved locally with that turn, and retries and edited branches reuse that saved version. Markdown/JSON exports include the extracted text and webpage provenance.

## Ask about files

Attach supported files in the composer, preview the extracted text, and inspect the draft Provider context before sending. Previews are local and do not contact a Provider or save a draft. Navigating away or reloading discards draft attachments.

| Limit | Supported value |
| --- | --- |
| Files per turn | Up to 4 |
| Original file size | Up to 4 MiB per file |
| Formats | UTF-8 text, Markdown, code, and text-based PDF |
| Extracted text | Up to 60,000 Unicode characters per file and 120,000 across attachments |
| Text lines | Up to 4,000 per text file |
| PDF pages | Up to 50 |
| Total application input | Up to 240,000 Unicode characters, including System Prompt and selected history |

Empty, binary, password-protected, scanned-only, unsupported, and oversized inputs are rejected. Run OCR outside Cove for scanned PDFs. These application limits are not token counts; a model can have a smaller context window.

On submission, Cove saves the original bytes and an immutable extracted-text snapshot with the turn. Providers receive extracted text through the selected transport. Comparisons, retries, and later selected context use the saved snapshot even if the original file changes on disk.

Open an answer's source citations to navigate saved lines or pages. Citations are navigation aids, not independent proof that a model's claim is correct. Original files can be downloaded from the saved source view. Conversation exports contain source text and metadata, but not original file bytes.

## Appearance and local data

Settings offers Continuum, Blueprint, Studio, and Grove workspace skins, with Light, Dark, and System appearance. Skin choice is saved in the browser for the Local Service address.

Search, pin, archive, rename, or export conversations from the workspace. History, settings, and attachments are stored under `~/Library/Application Support/cove/` in SQLite; Provider Keys use Keychain. Cove does not encrypt its local database or exports. Quit Cove before backing up its data directory, and protect backups like the original data. A database backup does not include Keychain credentials.

Search matches titles and saved user/assistant text, including Unicode content, within the current active or archived list. Message matches show a short excerpt; selecting one opens its originating turn. Up to 50 conversations are returned per search, so refine broad queries. Search stays on your Mac and does not send content to a Provider.

Updated builds index saved message text locally; the first launch after upgrading builds that index for existing history. For larger histories, use at least three characters to benefit from indexed phrase matching. Shorter queries remain supported through a local scan.

![Local history search showing a matching message excerpt and its conversation, using synthetic content](images/history-search.png)

Switching conversations, changing the archive filter, or starting a new chat asks before discarding unsent text or attachments, including files whose preview is still loading. Stay keeps the current draft; Discard and continue completes navigation. Browser navigation also requests confirmation for an unsent draft where supported. Drafts are held in memory rather than saved to browser storage.

Markdown exports group comparison answers with their user turn and identify the Selected Answer, an explicitly context-skipped turn, or an unresolved comparison. Labels describe saved state at export time; they do not change the immutable Context Snapshots of already submitted turns. Other completed answers and saved source snapshots remain included.

Deleting a conversation or clearing history removes its saved attachment records. It does not delete exported files, backups, or copies retained by a Provider. See the [privacy model](privacy.md) for storage, network destinations, and verification limits.

## Get help

Start with the [FAQ and troubleshooting guide](faq.md) for installation, Keychain access, unavailable models, and Local Service recovery.

Read the [beta release notes](releases/0.1.0-beta.8.md), use [GitHub Issues](https://github.com/tokenfunplus/cove/issues) for reproducible problems, or join the [Cove Discord community](https://discord.gg/7jdddhG8ZG) for setup discussion. Include the app and macOS versions in bug reports, and remove credentials, launch URLs, and private content from diagnostics.

## Let a model search the web

Click the globe beside Send to turn Web search on or off for the current conversation. New conversations start off. If no default search key is configured, Cove opens Settings → Web search and preserves your draft. Choose Tavily, Linkup, or Exa, enter a key, and use **Test and save**. Key testing makes one search request. The current conversation enables Web search after successful setup; close Settings and send your question.

With the toggle on, models can search, read public HTML pages, or answer directly. Each model attempt defaults to three search requests, five page reads, five results per search, eight total tool calls, and a ninety-second web phase. Settings groups the search connection and per-model request limits separately. Expand **Advanced settings** for search depth, result counts, tool limits, timeout, and domain filters. Four comparison models can use up to twelve searches with defaults. Failed requests count, cached results do not; request limits do not represent a billing-credit cap. Retries start independent budgets. Stop cancels active web requests. The existing overall Generation timeout still applies.

Answers link to saved source sections and list resolvable citations under **References**. Click a title for the saved excerpt or page; **Original** opens the source website. **Web research** shows queries, page reads, cache hits, errors, and usage when the search service reports it. Search excerpts are labelled separately from retrieved pages. If no tools were used, the answer says Web search was available and unused. Sources are retained with history, retries, branches, and local exports.

Web search requires native tool calling support from the chosen model. A rejected or incompatible tool request fails visibly; turn the toggle off or choose another model. Cove does not silently switch search Providers. Search queries go to the selected search service outside NearAI encrypted inference. Dynamic JavaScript rendering, signed-in pages, and private network addresses are not supported. Continuous Debate and answer-tool side conversations do not inherit the main chat toggle. The composer toolbar uses icons for **Attach files**, **Read webpage**, and **Review context**; hover or focus an icon for its label. Manual **Read webpage** remains available through the link icon.
