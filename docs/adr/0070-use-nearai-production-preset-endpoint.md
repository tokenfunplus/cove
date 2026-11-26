# Use the NearAI production endpoint for the preset

Date: 2026-11-26

Status: Accepted

This supersedes the staging destination in [ADR 0004](0004-keep-nearai-preset-bound-to-its-service.md). The NearAI preset now uses the fixed production service origin `https://cloud-api.near.ai`. HTTP adapters and the byte-preserving inference proxy append their existing `/v1` routes; the stored origin does not include `/v1`. The frontend setup default, backend endpoint validation, active-profile fixtures, and proxy/credential tests use the same production destination. The official [NearAI quickstart](https://docs.near.ai/cloud/quickstart) documents this gateway.

Existing stored `nearai` presets at exactly `https://cloud-stg-api.near.ai` are interpreted as the production preset by Provider configuration. Their identity, model selection, timestamps, and credential reference are retained; saving the profile writes the production origin. This is a narrowly scoped transition for Cove's fixed preset, not a relaxation of destination/key binding for custom Providers. Custom OpenAI-compatible staging connections remain unchanged, and arbitrary destinations remain invalid for the NearAI preset. Stale callers submitting the staging endpoint as a new or edited preset must refresh their configuration.

Reading configuration performs only credential-presence checks. It does not read keys or contact either service. Explicit connection tests continue to authenticate through `POST /v1/check_api_key` before catalog discovery, and rejected credentials remain visible failures. Private inference continues to require the existing attestation, encryption, and response verification. No successful production authentication or model availability is inferred from a formerly configured staging connection.

Historical Generation and Debate snapshots retain their original destinations and evidence. No conversation data, saved proof, custom connection, secret value, or database schema is rewritten by this compatibility rule. Regression coverage verifies existing-profile resolution, production-bound validation and proxy traffic, credential/selection retention, and unchanged custom staging connections.
