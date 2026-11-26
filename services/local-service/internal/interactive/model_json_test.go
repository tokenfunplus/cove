package interactive

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBoundedModelBracketRepair(t *testing.T) {
	valid := `{"cove_ui":1,"title":"Choose","children":[{"type":"Choice","options":["First","Second"]}],"continue":"Next"}`
	broken := strings.Replace(valid, `]}],`, `]],`, 1) + "}"
	quoted, _ := json.Marshal("Quote \\\" and brackets ] } [")
	for _, input := range []string{valid, broken, valid + "}}]", strings.Replace(valid, `"First"`, string(quoted), 1)} {
		for _, body := range []string{input, "```cove-ui JSON block:\n" + input + "\n```", "```json\n" + input + "\n```"} {
			d, err := Extract(body)
			if err != nil {
				t.Fatal("bounded repair rejected", body, err)
			}
			raw, _ := json.Marshal(d)
			if _, err = Parse(raw); err != nil {
				t.Fatal("repaired definition not canonical", err)
			}
		}
	}
	for _, input := range []string{
		valid[:len(valid)-1],
		strings.Replace(valid, `"Second"`, `"Second`, 1),
		strings.Replace(valid, `"First","Second"`, `"First" "Second"`, 1),
		strings.Replace(valid, `"title":"Choose"`, `"title":"Choose","title":"Other"`, 1),
		strings.Replace(valid, `"Choice"`, `"ExternalAction"`, 1),
		strings.Replace(valid, `1,`, `undefined,`, 1),
		valid + strings.Repeat("}", 9),
		valid + `{"another":"object"}`,
		strings.Replace(valid, `"Choose"`, `"`+strings.Repeat("x", 33000)+`"`, 1),
	} {
		if _, err := Normalize([]byte(input)); err == nil {
			t.Fatal("ambiguous or unsafe model output accepted")
		}
	}
	if _, err := Parse([]byte(broken)); err == nil {
		t.Fatal("storage parser performed model repair")
	}
}

func TestSliderInitialValuesUseHumanLabelsAndNearestLegalStep(t *testing.T) {
	for _, tc := range []struct{ value, want int }{{3, 2}, {4, 5}, {-8, -7}, {-99, -10}, {99, 20}} {
		raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Budget", "children": []any{map[string]any{"type": "Slider", "min": -10, "max": 20, "step": 3, "value": tc.value}}})
		d, err := Normalize(raw)
		if err != nil {
			t.Fatal(err)
		}
		for key, v := range d.Spec.State {
			if numberOr(v, -100) != tc.want {
				t.Fatalf("value %d mapped to %v, want %d", tc.value, v, tc.want)
			}
			for _, n := range d.Spec.Elements {
				if n.Type == "Slider" && (n.Props["label"] != "Value" || n.Props["label"] == key) {
					t.Fatal("internal identifier shown to user")
				}
			}
		}
	}
}

func FuzzModelInputBoundary(f *testing.F) {
	for _, seed := range []string{"", "{", `{"cove_ui":1,"children":[{"type":"Text","content":"Brackets ] } and quote \\\""}],"continue":false}}`, "```cove-ui JSON block:\n{}\n```", string([]byte{0xff, '{', '}'})} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, body string) {
		if len(body) > 40000 {
			t.Skip()
		}
		d, err := Extract(body)
		if err != nil {
			return
		}
		block, err := modelBlock(body)
		if err != nil || block.start < 0 || block.end > len(body) || block.start >= block.end {
			t.Fatal("invalid original source span")
		}
		if d.Validate() != nil {
			t.Fatal("model adapter bypassed storage validation")
		}
		prose := body[:block.start] + body[block.end:]
		if !strings.HasPrefix(HistoryText(body), prose) {
			t.Fatal("history projection changed original prose")
		}
	})
}
