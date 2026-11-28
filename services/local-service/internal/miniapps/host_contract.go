package miniapps

import (
	"maps"
	"slices"
)

// RuntimeVersion is the version of the declarative Mini App host contract.
const RuntimeVersion = "1.2.0"

type ActionOutput struct {
	Kind   string            `json:"kind"`
	Fields map[string]string `json:"fields,omitempty"`
}

func validateHostContract(p Package) error {
	if p.SpeechLanguage != "" && (p.SpeechLanguage != "ja" || !slices.Contains(p.Capabilities, "speech.speak")) {
		return invalid("speech language requires a supported language and speech.speak")
	}
	minHost := p.MinHostVersion
	if minHost != "" && (!semver.MatchString(minHost) || newer(minHost, RuntimeVersion)) {
		return invalid("package requires a different Mini App host version")
	}
	requires11 := false
	for _, page := range p.Pages {
		requires11 = requires11 || page.Practice != nil
	}
	for _, collection := range p.Collections {
		requires11 = requires11 || collection.Links != nil
		if collection.TitleField != "" && (minHost == "" || newer("1.2.0", minHost)) {
			return invalid("collection title_field requires min_host_version 1.2.0")
		}
	}
	for id, action := range p.Actions {
		requires11 = requires11 || action.OutputSchema != nil || action.Op == "delete" || action.Defaults != nil || action.LimitInput != "" || action.CountInput != "" || action.Selection != nil || action.CandidateBindings != nil
		for _, predicate := range action.Where {
			requires11 = requires11 || predicate.Field == "$id"
		}
		output := action.OutputSchema
		if output == nil {
			continue
		}
		expected := ActionOutput{Kind: "records", Fields: p.Collections[action.Collection].Fields}
		if action.Op == "delete" {
			expected.Fields = nil
		}
		if action.Op == "generate" {
			expected = ActionOutput{Kind: "text"}
			if action.CandidateAction != "" {
				expected = ActionOutput{Kind: "candidates", Fields: p.Actions[action.CandidateAction].Inputs}
			}
		}
		if output.Kind != expected.Kind || !maps.Equal(output.Fields, expected.Fields) {
			return invalid("action output schema for " + id)
		}
	}
	if (requires11 || p.SpeechLanguage != "") && (minHost == "" || newer("1.1.0", minHost)) {
		return invalid("new package features require min_host_version 1.1.0")
	}
	return nil
}

func CompatibleHostVersion(minimum string) bool {
	return minimum == "" || semver.MatchString(minimum) && !newer(minimum, RuntimeVersion)
}
