package miniapps

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestGenerateIncludesEveryReviewedInput(t *testing.T) {
	action := Action{Prompt: "Generate practice questions.", TextInput: "passage"}
	const source = "Sample text."
	inputs := map[string]any{"passage": source}
	original := generate(Package{}, action, inputs)
	if original.Prompt != action.Prompt+"\n\nSource material:\n"+source {
		t.Fatal("single-input prompt changed")
	}
	params := map[string]any{"count": float64(3), "language": "Japanese", "hints": false}
	for key, v := range params {
		inputs[key] = v
	}
	prompt := generate(Package{}, action, inputs).Prompt
	before, material, ok := strings.Cut(prompt, "\n\nSource material:\n")
	if !ok || material != source {
		t.Fatal("missing source material")
	}
	_, raw, ok := strings.Cut(before, "\n\nUser-selected parameters (JSON):\n")
	var got map[string]any
	if !ok || json.Unmarshal([]byte(raw), &got) != nil || !reflect.DeepEqual(got, params) {
		t.Fatalf("typed parameters differ: %v", got)
	}
}
