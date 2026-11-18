# Cove

Cove is a local-first macOS AI chat application. It has no Cove account, cloud conversation store, or synchronization service.

## Language

**Launcher**:
The menu-bar application that owns the lifecycle of Cove's bundled local service and opens its authenticated chat surface.
_Avoid_: Desktop client, native chat app

**Local Service**:
The process on the user's Mac that owns Cove's local data, browser API, and Provider interactions.
_Avoid_: Cloud backend, remote service

**Chat Surface**:
The authenticated local web interface through which a user reads and manages conversations and starts Generations.
_Avoid_: WKWebView, embedded native view

The Chat Surface follows a familiar ChatGPT-like conversation workspace for layout and interaction, while Cove's Provider Snapshot remains visible in each assistant message header.

**Provider Profile**:
A user-configured, non-secret description of a model provider connection, including its endpoint and transport metadata. It does not select a model; model targets belong to the Active Model Set.
_Avoid_: API key, provider account

**Preset Provider**:
A Provider Profile supplied by Cove with a fixed service identity and endpoint, such as NearAI; users configure its secret and select an available model but do not edit the preset's service endpoint.
_Avoid_: Built-in account, Secure Chat provider

**Provider Snapshot**:
The immutable record of the Provider Profile information actually used for one Generation.
_Avoid_: Current provider settings, live provider metadata

**Privacy Notice**:
The plain-language statement attached to a Provider Snapshot that tells the user where conversation content is sent and what Cove does and does not claim about transport, computation, or storage security.
_Avoid_: Security guarantee, Encryption promise

**Generation**:
One model's attempt to obtain an assistant response to a user message, with its own identifier, lifecycle state, and Provider Snapshot. A Generation belongs to one Generation Target.
_Avoid_: Message, stream

**Generation Batch**:
The durable record of one submitted user message, its idempotency key, and its ordered set of one to four Generation Targets. A Batch with more than one Target is a Model Comparison.
_Avoid_: Generation, merged response

**Generation Target**:
One selected Provider Profile and model within a Generation Batch. It owns an ordered series of Generation attempts, beginning with its initial attempt and extended only by a retry of that Target. Every attempt uses the Batch's Context Snapshot.
_Avoid_: Generation, provider default

**Selected Answer**:
The one completed Generation selected to represent a Generation Batch in later Provider context. A single-target Batch selects its completed answer automatically; a Model Comparison requires the user to select one answer. It may be changed until a later Batch captures it in a Context Snapshot.
_Avoid_: Best model, merged answer

**Context Snapshot**:
The immutable ordered references to Selected Answers that a Generation Batch supplied to its Providers. It does not change if the user later chooses a different answer for an earlier Batch.
_Avoid_: Live conversation history, Provider transcript

**Source Document**:
A text, code, or text-based PDF file attached to a submitted user message. Cove retains its original bytes locally and sends its extracted text through the selected Provider transport.
_Avoid_: Provider upload, Knowledge base

**Attachment Snapshot**:
The immutable original-file identity, filename, parser version, and extracted line/page sections saved with a Generation Batch. Every Target and retry uses the same saved source input. A source citation navigates to a section; it does not establish factual correctness or cryptographic verification.
_Avoid_: Live file reference, Verified source

**Context-Skipped Batch**:
A Generation Batch the user explicitly chose not to represent in later Provider context. Its user message and every local result remain in Conversation History but are excluded from later Context Snapshots. The choice may change until a later Batch captures the disposition in its Context Snapshot.
_Avoid_: Deleted turn, failed turn

**Model Comparison**:
The Chat Surface action of sending one user message to several selected models concurrently and presenting each model's Generation as an independent answer for comparison.
_Avoid_: Multi-turn conversation, merged response

**Active Model Set**:
The one or more Provider Profile and model targets selected in the workspace for future Generations. A set of one produces a normal single-model answer; a larger set produces a Model Comparison.
_Avoid_: Request-supplied model list, provider default

**Key Rotation**:
The deliberate replacement of a Provider Profile's secret with a newly validated secret, preserving the previous usable secret when validation of the replacement fails.
_Avoid_: Automatic renewal, password reset

**Conversation History**:
The locally retained ordered record of a conversation's user messages, completed assistant messages, Generations, and their Provider Snapshots.
_Avoid_: Cloud transcript, remote conversation

**Live Turn**:
The non-persistent, screen-local representation of a submitted user message and its Generation while the Chat Surface awaits or renders its result. It reconciles with Conversation History when the Local Service has authoritative state.
_Avoid_: Optimistic message, temporary message, streaming message

**Conversation Title**:
The user-visible local name of a Conversation, initially derived from its first user message and editable without contacting a Provider.
_Avoid_: AI-generated summary, Remote title

**Side Conversation**:
A separate locally saved conversation opened beside a source answer. Its first user message contains the chosen passage and question; it does not inherit the main conversation's history or change its Selected Answers.
_Avoid_: Hidden context, merged conversation

**Working Draft**:
An editable, window-local copy of a saved answer. Manual edits and explicitly applied model revisions do not modify the original answer, verification evidence, or Provider context. Downloading preserves the draft outside this window.
_Avoid_: Edited Generation, verified revision

**Generation Metrics**:
Observed per-attempt elapsed times and optional Provider-reported input/output token counts. Browser measurements include the private-inference verification path. Missing measurements are unavailable, not zero; costs calculated from user-supplied rates are estimates.
_Avoid_: Billing receipt, benchmark guarantee

**Unconfigured Provider**:
A Provider Profile whose non-secret settings remain available but whose Keychain secret is absent or has been deleted, so it cannot start a Generation.
_Avoid_: Deleted provider, Invalid provider

**Browser Session**:
The short-lived local authorization state created when the Launcher exchanges a one-time launch token for access to the Chat Surface.
_Avoid_: Secure Chat account, Cloud login

**Reasoning**:
Provider-declared intermediate text saved separately from the final assistant body. It collapses after streaming and stays out of later Selected Answer context. Older embedded tagged blocks have a presentation fallback; unmarked historical prose is not reclassified.
_Avoid_: Final answer, verification evidence

**Model Catalog Details**:
Optional Provider-advertised names, prices, context/output limits, and capabilities shown when selecting a model. Local brand icons identify model families; they do not establish transport or verification properties.
_Avoid_: Billing guarantee, enabled client feature

**Conversation Branch**:
A separate locally saved conversation created by editing a saved user turn. Its inherited history copies that turn's immutable Selected Answer context and source snapshots; the new prompt uses current generation settings. Deleting the source does not change the branch.
_Avoid_: Mutated original conversation, newly verified copied answer

**Conversation Branch**:
A separate locally saved conversation created by editing a saved user turn. Its inherited history copies that turn's immutable Selected Answer context and source snapshots; the new prompt uses current generation settings. Deleting the source does not remove the branch's copies.
_Avoid_: Edited original history, regenerated evidence
