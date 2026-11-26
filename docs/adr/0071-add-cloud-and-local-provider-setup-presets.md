# Add cloud and local Provider setup presets

Date: 2026-11-26

Status: Accepted

Provider setup adds OpenRouter, OpenAI, MiniMax, Ollama, and LM Studio alongside NearAI and the blank OpenAI-compatible option. Bundled defaults live in `internal/provider/presets.json`, imported by the Chat Surface and embedded by the Local Service. These five are setup templates for ordinary `openai_compatible` profiles, not additional inference kinds or confidentiality classifications. Saved labels are inferred from their endpoint; display names remain user editable. Their endpoints and authentication can be edited, while NearAI retains its fixed service identity and verification flow.

| Preset | Default API base | Authentication |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer |
| OpenAI | `https://api.openai.com/v1` | Bearer |
| MiniMax | `https://api.minimax.cn/v1` | Bearer |
| Ollama | `http://127.0.0.1:11434/v1` | None |
| LM Studio | `http://127.0.0.1:1234/v1` | None, or Bearer for a protected server |

The new `none` authentication value is valid only for loopback destinations and ordinary compatible profiles. It rejects submitted secrets, skips Secret Store access, and omits authentication headers. Saving a keyless connection explicitly validates its catalog and selected model before publication. Configured means that this connection has its required configuration, not that an external process is always running. Local connection errors remain visible, and the user owns server startup, model loading, and external model storage. These services retain the existing User local service classification; they are not Cove-managed workers and are not admitted by Only on this Mac.

Switching setup templates clears draft credentials, model results, and test status. Local services hide key rotation and deletion controls while using None; users can select Bearer when their server requires a token. Changes to a keyed destination continue to require a new supplied key. Successfully changing to keyless mode drops the previous credential reference only after validation and atomic profile publication. The Provider profile contract adds `none`; no SQLite layout change is needed, and existing profiles retain their authentication. Builds predating this value cannot use saved keyless profiles.

OpenRouter explicitly checks `GET /api/v1/key` before trusting its public catalog. OpenAI uses `max_completion_tokens` in chat validation and streaming. MiniMax uses the publisher-listed MiniMax-M3.1-Flash and MiniMax-M3 entries rather than assuming an account-specific model-directory API; testing without a selected model authenticates through a short chat probe against the first listed model. A selected model is independently checked by the existing chat preflight. Catalog presence does not establish model availability or a valid key. MiniMax defaults target the standard platform API, not a separate subscription endpoint.

HTTP remains an adapter, Provider configuration owns credentials and connection publication, and Chat retains generation scheduling and snapshots. Regression tests cover all five setup choices, clearing stale draft state, opt-in local tokens, cloud paths and token fields, rejected cloud keys, loopback-only None authentication, and keyless save/reopen/catalog/stream/removal with a temporary database and an unused Secret Store.

Review follow-up: MiniMax validation decodes a bounded JSON response even after HTTP success. A missing `base_resp` remains compatible with OpenAI-shaped responses; codes 1004 and 2049 become authentication failures, and other nonzero codes or malformed responses become protocol failures. Failed validation preserves the saved profile and credential reference. See the publisher's [error codes](https://platform.minimax.io/docs/api-reference/errorcode). Preset matching compares URL components, ignoring host casing and explicit default ports while retaining API-path distinctions. This does not change credential destination binding or persisted endpoint values.

Sources: [OpenRouter authentication](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key), [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [MiniMax OpenAI compatibility](https://platform.minimax.cn/docs/api-reference/text-openai-api), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [LM Studio authentication](https://lmstudio.ai/docs/developer/core/authentication).
