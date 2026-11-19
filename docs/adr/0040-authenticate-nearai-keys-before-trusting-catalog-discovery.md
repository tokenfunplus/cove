# Authenticate NearAI keys before trusting catalog discovery

The NearAI preset validates a supplied or saved Key through `POST /v1/check_api_key` before using its public model catalog as a connection-test result. The check uses the fixed preset destination, the same server-held credential as inference, the existing preflight timeout and redirect restrictions, and existing sanitized error classifications. It submits no completion or conversation content. A rejected check stops validation; catalog discovery is never a fallback for authentication.

This extends ADR-0004's preset connection validation. The upstream public catalog deliberately tolerates invalid credentials. A synthetic invalid Key returned 200 from `/v1/models` and 401 from both `/v1/check_api_key` and `/v1/attestation/report`. Previously a test without a selected model could report success after the catalog request alone. Once a model is selected, the existing ordinary chat preflight remains in place.

Profile/key publication and ADR-0026's Keychain cache rules remain authoritative: a replacement is validated before publication, written and read back through the Secret Store, and referenced by the saved profile before the old credential is removed. Saving metadata without a new Key does not perform this validation and must preserve the previous connection-test status instead of inventing a successful test.

Connection validation is distinct from hardware verification. Browser-side attestation, model selection restrictions, byte-preserving proxying, encryption, and response verification remain required for Private TEE inference. This decision does not suppress a rejected Key, strip authentication on retry, or substitute an anonymous proof for an authenticated failure.

The upstream [key-check route](https://github.com/nearai/cloud-api/blob/45b24470dc9447081ac4fe81e6e31e54d757c5d4/crates/api/src/lib.rs) and [public catalog authentication policy](https://github.com/nearai/cloud-api/blob/45b24470dc9447081ac4fe81e6e31e54d757c5d4/crates/api/src/middleware/auth.rs) define the checked behavior.
