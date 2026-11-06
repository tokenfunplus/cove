# Restrict custom Provider endpoints to secure transport

Custom Provider Profiles may use any HTTPS endpoint, while HTTP is accepted only for loopback hosts (`localhost`, `127.0.0.1`, and `::1`). Other cleartext endpoints are rejected so API keys and conversation context are not sent over network plaintext; the UI reports transport security separately from claims about Provider computation or storage.

## Considered Options

- Allow any URL: rejected because a valid OpenAI-compatible endpoint can still expose secrets and chat content over cleartext transport.
- Allow HTTPS only: rejected because local development and user-run loopback services need a practical cleartext path.
