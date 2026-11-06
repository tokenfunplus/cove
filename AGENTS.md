# Contributor and agent guidance

- Read `CONTEXT.md` and relevant decisions in `docs/adr/` before changing domain behavior. Record changes that supersede an existing decision.
- Use English for documentation, interface copy, comments, filenames, and diagnostics. Unicode user content remains supported; use escapes when tests need non-English fixtures.
- Preserve the boundaries described in `docs/architecture.md`: HTTP handlers adapt requests, Chat owns generation lifecycles, and persistence owns local storage.
- Never commit Provider Keys, launch tokens, conversation data, or local state. Remove them from diagnostics before sharing.
- Build web assets before compiling a runnable Local Service. Generated output under `services/local-service/internal/webassets/content/dist/` must stay untracked.
- Use `COVE_DATA_DIR` pointing to a temporary directory for integration checks. Plaintext test credentials require explicit `COVE_INSECURE_FILE_SECRET_STORE=1`.
- Run `make check` and appropriate tests. macOS packaging requires an Apple Silicon Mac; see `docs/development.md`.
- Keep changes focused and document material behavior or compatibility changes. Do not publish releases, push changes, or contact third parties unless requested.
