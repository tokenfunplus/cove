package appcatalog

import (
	"crypto/ed25519"
	"encoding/base64"
)

// Earlier versions accepted line breaks in base64 public keys. Canonicalize only
// persisted/trusted configuration here; new settings still require canonical input.
func canonicalCatalog(config Catalog) Catalog {
	config.PublicKey = canonicalAuthorityKey(config.PublicKey)
	return config
}

func canonicalAuthorityKey(key string) string {
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != ed25519.PublicKeySize {
		return key
	}
	return base64.StdEncoding.EncodeToString(decoded)
}

func normalizeAuthorityPreferences(previous preferences) preferences {
	if previous.Config != nil {
		config := canonicalCatalog(*previous.Config)
		previous.Config = &config
	}
	checkpoints := make(map[string]checkpoint, len(previous.Checkpoints))
	for key, accepted := range previous.Checkpoints {
		key = canonicalAuthorityKey(key)
		prior, exists := checkpoints[key]
		switch {
		case !exists || accepted.Sequence > prior.Sequence:
			checkpoints[key] = accepted
		case accepted.Sequence == prior.Sequence && accepted.Digest != prior.Digest:
			// No valid SHA-256 digest is empty. Equal-sequence equivocation rejects
			// every candidate at that sequence until a strictly newer index arrives.
			prior.Digest = ""
			checkpoints[key] = prior
		}
	}
	previous.Checkpoints = checkpoints
	histories := make(map[string]authorityHistory, len(previous.Authorities))
	for key, history := range previous.Authorities {
		key = canonicalAuthorityKey(key)
		combined := histories[key]
		if combined.Versions == nil {
			combined.Versions = make(map[string]string)
		}
		if combined.Releases == nil {
			combined.Releases = make(map[string]bool)
		}
		if combined.Publishers == nil {
			combined.Publishers = make(map[string]bool)
		}
		for version, digest := range history.Versions {
			if known, exists := combined.Versions[version]; exists && known != digest {
				// Preserve an immutable conflict rather than arbitrarily blessing one
				// alias's package. Future indexes may omit, but cannot rewrite, it.
				combined.Versions[version] = ""
			} else {
				combined.Versions[version] = digest
			}
		}
		for digest, accepted := range history.Releases {
			combined.Releases[digest] = combined.Releases[digest] || accepted
		}
		for publisher, accepted := range history.Publishers {
			combined.Publishers[publisher] = combined.Publishers[publisher] || accepted
		}
		histories[key] = combined
	}
	for key, history := range histories {
		accepted := make(map[string]bool, len(history.Versions))
		for _, digest := range history.Versions {
			if digest != "" {
				accepted[digest] = true
			}
		}
		for digest := range history.Releases {
			if !accepted[digest] {
				delete(history.Releases, digest)
			}
		}
		histories[key] = history
	}
	previous.Authorities = histories
	return previous
}
