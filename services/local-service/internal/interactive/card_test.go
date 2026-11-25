package interactive

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestSharedContractFixtures(t *testing.T) {
	b, e := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures struct {
		Valid, Invalid []struct{ Name, Source string }
	}
	if json.Unmarshal(b, &fixtures) != nil {
		t.Fatal("fixtures")
	}
	for _, f := range fixtures.Valid {
		t.Run(f.Name, func(t *testing.T) {
			d, e := Parse([]byte(f.Source))
			if e != nil {
				t.Fatal(e)
			}
			if _, e = Extract("Text\n```" + d.Version + "\n" + f.Source + "\n```\n"); e != nil {
				t.Fatal(e)
			}
			if e = d.ValidateValues(d.Spec.State, nil, false); e != nil {
				t.Fatal(e)
			}
		})
	}
	for _, f := range fixtures.Invalid {
		t.Run(f.Name, func(t *testing.T) {
			if _, e := Parse([]byte(f.Source)); e == nil {
				t.Fatal("accepted invalid fixture")
			}
		})
	}
	if _, e = Parse([]byte(strings.Repeat(" ", 32769))); e == nil {
		t.Fatal("oversized block accepted")
	}
	catalog, e := os.ReadFile("../../../../packages/api-contract/catalogs/interactive-v1.json")
	if e != nil || string(catalog) != CatalogJSON {
		t.Fatal("bundled catalog drift", e)
	}
	for _, source := range []string{"```json\n{}\n```", "> ```cove-card-v1\n{}\n```", "```cove-card-v1\n{}", "```cove-card-v1\n{}\n```\n```cove-card-v1\n{}\n```"} {
		if _, e := Extract(source); e == nil {
			t.Fatal("activated malformed or quoted source")
		}
	}
}

func TestRichValueFixtures(t *testing.T) {
	b, err := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Valid  []struct{ Name, Source string }
		Values []struct {
			Name, Definition string
			Values           map[string]any
			Valid            bool
		}
	}
	if err = json.Unmarshal(b, &fixtures); err != nil {
		t.Fatal(err)
	}
	definitions := map[string]Definition{}
	for _, f := range fixtures.Valid {
		d, err := Parse([]byte(f.Source))
		if err != nil {
			t.Fatal(f.Name, err)
		}
		definitions[f.Name] = d
	}
	for _, f := range fixtures.Values {
		t.Run(f.Name, func(t *testing.T) {
			if err := definitions[f.Definition].ValidateValues(f.Values, nil, false); (err == nil) != f.Valid {
				t.Fatal("unexpected validation", err)
			}
		})
	}
	d := definitions["playground"]
	values := d.Spec.State
	values["order"] = []any{"gallery", "walk", "lunch"}
	values["food"] = float64(100)
	summary, input, err := d.Input(values, nil, "")
	if err != nil || !strings.Contains(summary, "Explore a small gallery > Walk by the river > Lunch with a friend") || !strings.Contains(input, `"remaining":-20`) || !strings.Contains(input, `"calculation":"allocation-sum-v1"`) || !strings.Contains(input, `"version":"interaction-v2"`) {
		t.Fatal("incomplete rich snapshot", err)
	}
	values["draft"] = "   "
	if d.ValidateValues(values, nil, true) == nil {
		t.Fatal("blank required edit submitted")
	}
	if _, err := Extract("``` COVE-CARD-V2 \n" + fixtures.Valid[len(fixtures.Valid)-1].Source + "\n```"); err != nil {
		t.Fatal("known framing alias not normalized", err)
	}
	catalog, err := os.ReadFile("../../../../packages/api-contract/catalogs/interactive-v2.json")
	if err != nil || string(catalog) != CatalogV2JSON {
		t.Fatal("v2 catalog drift")
	}
}

func TestSharedSourceFramingAndGuideExamples(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-sources.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Body string
		Valid      bool
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			_, err := Extract(f.Body)
			if (err == nil) != f.Valid {
				t.Fatal("framing parity", err)
			}
		})
	}
	expected, err := os.ReadFile("../../../../packages/api-contract/examples/interactive-v2.json")
	if err != nil {
		t.Fatal("legacy example corpus unavailable", err)
	}
	var examples []struct {
		Name       string
		Definition json.RawMessage
	}
	if err = json.Unmarshal(expected, &examples); err != nil {
		t.Fatal(err)
	}
	for _, e := range examples {
		if _, err = Parse(e.Definition); err != nil {
			t.Fatal(e.Name, err)
		}
	}
	found := false
	for _, line := range strings.Split(guide, "\n") {
		if strings.HasPrefix(line, "{\"cove_ui\"") {
			found = true
			if _, err := Normalize([]byte(line)); err != nil {
				t.Fatal("guide example invalid", err)
			}
		}
	}
	if !found {
		t.Fatal("missing complete nested example")
	}
	if !strings.Contains(Prompt(), "intent:\"discuss\"") || !strings.Contains(Prompt(), "prose is the default") {
		t.Fatal("missing conversational guidance")
	}
}

func TestModelInputNormalization(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-normalization.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Source string
		Valid        bool
		Canonical    json.RawMessage
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			d, err := Normalize([]byte(f.Source))
			if (err == nil) != f.Valid {
				t.Fatal("normalization result", err)
			}
			if f.Valid {
				actual, _ := json.Marshal(d)
				var a, b any
				json.Unmarshal(actual, &a)
				json.Unmarshal(f.Canonical, &b)
				if !reflect.DeepEqual(a, b) {
					t.Fatal("canonical fixture drift")
				}
				if d.Validate() != nil {
					t.Fatal("unsafe canonical output")
				}
			} else {
				var detail *ValidationError
				if !errors.As(err, &detail) || detail.Path == "" {
					t.Fatal("missing detailed diagnostic", err)
				}
			}
		})
	}
	if (Definition{}).Validate() == nil {
		t.Fatal("unchecked exported validation accepted invalid definition")
	}
	if len([]rune(Prompt())) > 2200 {
		t.Fatal("interactive guide exceeded compact budget")
	}
}
func TestHistoryProjectionBoundsAndRetainsMeaning(t *testing.T) {
	raw, _ := os.ReadFile("../../../../packages/api-contract/fixtures/interactive-cards.json")
	var f struct{ Valid []struct{ Source string } }
	json.Unmarshal(raw, &f)
	body := "A lighthouse scene.\n```cove-card-v1\n" + f.Valid[0].Source + "\n```"
	summary := HistoryText(body)
	if strings.Contains(summary, "stateSchema") || !strings.Contains(summary, "Examine the abandoned radio") || len(summary) >= len(body) {
		t.Fatal("card history not compacted")
	}
	d, err := Parse([]byte(f.Valid[0].Source))
	if err != nil {
		t.Fatal(err)
	}
	_, input, err := d.Input(map[string]any{"next_action": "radio"}, nil, "Explain this", "source")
	if err != nil {
		t.Fatal(err)
	}
	compact := CompactReference(input)
	if strings.Contains(compact, "definition_hash") || strings.Contains(compact, "source_generation_id") || !strings.Contains(compact, "Examine the abandoned radio") {
		t.Fatal("reference history lost meaning")
	}
	if HistoryText("Ordinary prose") != "Ordinary prose" || CompactReference("Plain user text") != "Plain user text" {
		t.Fatal("ordinary history changed")
	}
}
