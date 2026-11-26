package interactive

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func legacyStory(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct{ Valid []struct{ Source string } }
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	var story map[string]any
	if err = json.Unmarshal([]byte(fixtures.Valid[0].Source), &story); err != nil {
		t.Fatal(err)
	}
	return story
}

func TestNormalizePreservesDeclaredContinuationSubset(t *testing.T) {
	m := legacyStory(t)
	spec := cloneMap(m["spec"])
	elements := cloneMap(spec["elements"])
	cloneMap(m["stateSchema"])["private_choice"] = map[string]any{"type": "string", "enum": []any{"", "private", "public"}}
	cloneMap(spec["state"])["private_choice"] = "private"
	elements["private-choice"] = map[string]any{"type": "Choice", "props": map[string]any{"value": map[string]any{"$bindState": "/private_choice"}, "mode": "single", "required": false, "options": []any{map[string]any{"value": "private", "label": "Private"}, map[string]any{"value": "public", "label": "Public"}}}, "children": []any{}}
	root := cloneMap(elements[stringValue(spec["root"])])
	root["children"] = append(root["children"].([]any), "private-choice")
	raw, _ := json.Marshal(m)
	if _, err := Parse(raw); err != nil {
		t.Fatal("subset control is not a valid canonical card", err)
	}
	d, err := Normalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	d.Spec.State["next_action"] = "radio"
	_, reference, err := d.Input(d.Spec.State, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(reference, "private_choice") || strings.Contains(reference, `"Private"`) {
		t.Fatal("normalization widened the declared submission")
	}
	params := cloneMap(cloneMap(cloneMap(elements["continue"])["on"])["press"])
	cloneMap(params["params"])["paths"] = nil
	raw, _ = json.Marshal(m)
	if _, err = Normalize(raw); err == nil {
		t.Fatal("declared invalid paths were replaced by defaults")
	}
}

func TestNormalizeKeepsExplicitFieldIDsAndGeneratedBindingsSeparate(t *testing.T) {
	for _, tc := range []struct{ kind, reader, property string }{{"Slider", "AllocationSummary", "paths"}, {"TextInput", "TextPreview", "value"}} {
		writers := []any{}
		for i, name := range []string{"field_2", "other"} {
			w := map[string]any{"type": tc.kind, "id": name, "label": name, "value": "draft"}
			if tc.kind == "Slider" {
				w["min"] = 0
				w["max"] = 10
				w["step"] = 1
				w["value"] = i + 1
			}
			writers = append(writers, w)
		}
		reader := map[string]any{"type": tc.reader, "label": "Preview", "field": "field_2"}
		if tc.kind == "Slider" {
			reader = map[string]any{"type": tc.reader, "label": "Balance", "fields": []string{"field_2"}, "total": 10}
		}
		writers = append(writers, reader)
		raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Separate namespaces", "children": writers})
		d, err := Normalize(raw)
		if err != nil {
			t.Fatal(tc.kind, err)
		}
		for _, n := range d.Spec.Elements {
			if n.Type == tc.reader {
				if tc.property == "paths" {
					if n.Props["paths"].([]any)[0] != "/field_1" {
						t.Fatal("reader used the later generated binding")
					}
				} else if cloneMap(n.Props["value"])["$bindState"] != "/field_1" {
					t.Fatal("preview used the later generated binding")
				}
			}
		}
	}
}

func TestNormalizeReservesLegacyRootAndAllExplicitOptionIDs(t *testing.T) {
	m := legacyStory(t)
	spec := cloneMap(m["spec"])
	elements := cloneMap(spec["elements"])
	cloneMap(cloneMap(elements["action-choice"])["props"])["answer"] = "radio"
	oldRoot := stringValue(spec["root"])
	elements["feedback_0"] = elements[oldRoot]
	delete(elements, oldRoot)
	spec["root"] = "feedback_0"
	raw, _ := json.Marshal(m)
	d, err := Normalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	if d.Spec.Elements[d.Spec.Root].Type != "Card" {
		t.Fatal("generated feedback overwrote the root")
	}
	for _, options := range [][]string{{"option_3", "option_3_1", "Needs space"}, {"Needs space", "option_1", "option_1_1"}} {
		raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Unique options", "children": []any{map[string]any{"type": "Choice", "options": options}}})
		d, err := Normalize(raw)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range d.Spec.Elements {
			if n.Type == "Choice" {
				seen := map[string]bool{}
				for i, item := range n.Props["options"].([]any) {
					v := stringValue(cloneMap(item)["value"])
					if seen[v] || (id(options[i]) && v != options[i]) {
						t.Fatal("explicit option was changed or generated ID collided")
					}
					seen[v] = true
				}
			}
		}
	}
}

func TestCandidateDetectionUsesFramingRatherThanKeywords(t *testing.T) {
	for _, body := range []string{"The cove_ui field describes a cove-ui card.", "```python\n{\"cove_ui\":1}\n```", "```cove-card-v99\n{}\n```", "> {\"cove_ui\":1}"} {
		if HasCandidate(body) {
			t.Fatal("ordinary explanation counted as model UI attempt")
		}
	}
	for _, body := range []string{"```cove-ui\n{", "```json\n{\"cove_ui\":1,", "Here is a card:\n{\"cove_ui\":1,\"children\":["} {
		if !HasCandidate(body) {
			t.Fatal("malformed UI attempt was missed")
		}
	}
}
