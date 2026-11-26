package provider

import (
	_ "embed"
	"encoding/json"
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
	base := strings.TrimSuffix(strings.TrimRight(profile.Endpoint, "/"), "/v1")
	for _, candidate := range presets {
		if base == strings.TrimSuffix(candidate.Endpoint, "/v1") {
			return candidate, true
		}
	}
	return preset{}, false
}

func usesCompletionTokenLimit(profile Profile) bool {
	p, ok := presetFor(profile)
	return ok && p.ID == "openai"
}
