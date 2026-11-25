package interactive

import (
	"encoding/json"
	"testing"
)

func TestNormalizeCountsImplicitRootAndGeneratedControls(t *testing.T) {
	for _, count := range []int{29, 30} {
		children := make([]any, count)
		for i := range children {
			children[i] = map[string]any{"type": "Text", "text": "A line"}
		}
		raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Boundary", "continue": false, "children": children})
		d, err := Normalize(raw)
		if count == 30 {
			if err == nil {
				t.Fatal("31 components accepted")
			}
			continue
		}
		if err != nil || len(d.Spec.Elements) != 30 {
			t.Fatal("30 components rejected", err)
		}
		canonical, _ := json.Marshal(d)
		if _, err = Normalize(canonical); err != nil {
			t.Fatal("canonical root counted twice", err)
		}
		if _, err = Parse(canonical); err != nil {
			t.Fatal("strict parser disagreed", err)
		}
	}
	children := make([]any, 28)
	for i := range children {
		children[i] = map[string]any{"type": "Text", "text": "A line"}
	}
	children = append(children, map[string]any{"type": "Choice", "label": "Choose", "options": []any{"One", "Two"}})
	raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Auto button", "children": children})
	if _, err := Normalize(raw); err == nil {
		t.Fatal("generated Continue exceeded 30 components")
	}
}

func TestNormalizeCountsGeneratedQuizControls(t *testing.T) {
	for _, texts := range []int{26, 27} {
		children := make([]any, texts)
		for i := range children {
			children[i] = map[string]any{"type": "Text", "text": "A line"}
		}
		children = append(children, map[string]any{"type": "Choice", "label": "Quiz", "options": []any{"One", "Two"}, "answer": "One"})
		raw, _ := json.Marshal(map[string]any{"cove_ui": 1, "title": "Quiz boundary", "continue": false, "children": children})
		d, err := Normalize(raw)
		if texts == 27 {
			if err == nil {
				t.Fatal("generated quiz controls exceeded 30 components")
			}
			continue
		}
		if err != nil || len(d.Spec.Elements) != 30 {
			t.Fatal("30-component quiz rejected", err)
		}
		canonical, _ := json.Marshal(d)
		if _, err = Normalize(canonical); err != nil {
			t.Fatal("canonical quiz count disagreed", err)
		}
	}
}
