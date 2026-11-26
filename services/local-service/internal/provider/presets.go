package provider

import (
	_ "embed"
	"encoding/json"
	"net/url"
	"strings"
)

//go:embed presets.json
var presetData []byte

type preset struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Endpoint   string   `json:"endpoint"`
	AuthMethod string   `json:"auth_method"`
	Models     []string `json:"models"`
}

var presets = func() []preset {
	var result []preset
	if err := json.Unmarshal(presetData, &result); err != nil {
		panic("invalid bundled Provider presets")
	}
	return result
}()

func presetFor(profile Profile) (preset, bool) {
	if profile.Kind != KindOpenAICompatible {
		return preset{}, false
	}
	base, ok := normalizedPresetEndpoint(profile.Endpoint)
	if !ok {
		return preset{}, false
	}
	for _, candidate := range presets {
		if endpoint, ok := normalizedPresetEndpoint(candidate.Endpoint); ok && base == endpoint {
			return candidate, true
		}
	}
	return preset{}, false
}

type presetEndpoint struct {
	scheme, host, port, path string
}

func normalizedPresetEndpoint(raw string) (presetEndpoint, bool) {
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return presetEndpoint{}, false
	}
	scheme := strings.ToLower(endpoint.Scheme)
	if scheme != "http" && scheme != "https" {
		return presetEndpoint{}, false
	}
	port := endpoint.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	path := strings.TrimSuffix(strings.TrimRight(endpoint.EscapedPath(), "/"), "/v1")
	return presetEndpoint{scheme, strings.ToLower(endpoint.Hostname()), port, path}, true
}

func usesCompletionTokenLimit(profile Profile) bool {
	p, ok := presetFor(profile)
	return ok && p.ID == "openai"
}
