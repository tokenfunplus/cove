package miniapps

import (
	"maps"
	"math"
	"slices"
	"strings"
	"time"
)

func actionInputs(a Action, provided map[string]any, now time.Time) (map[string]any, error) {
	inputs := make(map[string]any, len(a.Inputs))
	for key, value := range a.Defaults {
		inputs[key] = resolve(value, nil, now)
	}
	maps.Copy(inputs, provided)
	if !inputOK(inputs, a.Inputs) {
		return nil, invalid("action inputs")
	}
	for key, max := range map[string]int{a.LimitInput: 200, a.CountInput: 8} {
		if key == "" {
			continue
		}
		n := inputs[key].(float64)
		if n < 1 || n > float64(max) || math.Trunc(n) != n {
			return nil, invalid("count outside action range")
		}
	}
	return inputs, nil
}

func candidateDefinition(p Package, a Action) Action {
	target := p.Actions[a.CandidateAction]
	target.Inputs = maps.Clone(target.Inputs)
	for key := range a.CandidateBindings {
		delete(target.Inputs, key)
	}
	return target
}

func validateActionOptions(p Package, a Action) error {
	if !validValues(a.Defaults, a.Inputs, nil, false) {
		return invalid("input defaults")
	}
	if a.LimitInput != "" && (a.Op != "query" || a.Limit != 0 || a.Inputs[a.LimitInput] != "number") {
		return invalid("query limit input")
	}
	if a.CountInput != "" && (a.Op != "generate" || a.CandidateAction == "" || a.Inputs[a.CountInput] != "number") {
		return invalid("candidate count input")
	}
	for key, max := range map[string]int{a.LimitInput: 200, a.CountInput: 8} {
		if n, ok := a.Defaults[key].(float64); key != "" && ok && (n < 1 || n > float64(max) || math.Trunc(n) != n) {
			return invalid("count default")
		}
	}
	if a.Selection != nil {
		fields := p.Collections[a.Selection.Collection].Fields
		if fields == nil || len(a.Selection.Fields) == 0 {
			return invalid("record selection mapping")
		}
		for input, field := range a.Selection.Fields {
			typ := fields[field]
			if field == "$id" {
				typ = "text"
			}
			if typ == "" || typ != a.Inputs[input] {
				return invalid("record selection input")
			}
		}
	}
	for target, source := range a.CandidateBindings {
		if a.Op != "generate" || a.Inputs[source] == "" || p.Actions[a.CandidateAction].Inputs[target] != a.Inputs[source] {
			return invalid("candidate input binding")
		}
	}
	return nil
}

func validatePractice(p Package, page Page) error {
	cfg := page.Practice
	if cfg == nil {
		return nil
	}
	q := p.Actions[cfg.Query]
	fields := p.Collections[q.Collection].Fields
	if q.Op != "query" || !slices.Contains(page.Actions, cfg.Query) || fields[cfg.Front] != "text" || fields[cfg.Back] != "text" || cfg.Front == cfg.Back || len(cfg.Outcomes) < 1 || len(cfg.Outcomes) > 4 || !unique(cfg.Outcomes) {
		return invalid("practice page")
	}
	for _, id := range cfg.Outcomes {
		a := p.Actions[id]
		if !slices.Contains(page.Actions, id) || a.Op != "update" || a.Collection != q.Collection || len(a.Inputs) > 0 {
			return invalid("practice outcome")
		}
	}
	return nil
}

// HiddenInput identifies local record bindings managed by the host, not user text fields.
func HiddenInput(p Package, action Action, input string) bool {
	target := action
	if action.CandidateAction != "" {
		target = p.Actions[action.CandidateAction]
	}
	for field, link := range p.Collections[target.Collection].Links {
		for _, destination := range []string{field, link.Label} {
			value, ok := target.Values[destination].(string)
			if !ok {
				continue
			}
			name, ok := strings.CutPrefix(value, "$input.")
			if !ok {
				continue
			}
			if action.CandidateAction != "" {
				name = action.CandidateBindings[name]
			}
			if name == input {
				_, exists := action.Defaults[name]
				return exists
			}
		}
	}
	return false
}
