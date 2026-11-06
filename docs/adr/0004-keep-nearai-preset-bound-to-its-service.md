# Keep the NearAI preset bound to its service

The NearAI Preset Provider uses the fixed staging endpoint `https://cloud-stg-api.near.ai` and Bearer authentication for both model discovery and chat completion. After entering a valid key, the user selects a model from the provider's catalog; a custom endpoint is represented as a separate OpenAI-compatible Provider Profile rather than mutating the NearAI preset.

## Considered Options

- Let users edit the NearAI endpoint: rejected because it makes the preset's privacy and service identity ambiguous.
- Hardcode a default model: rejected because model availability can vary; the catalog is the authoritative source at setup time.
