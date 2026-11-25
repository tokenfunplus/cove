package interactive

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// Integer-only values keep validation and calculation deterministic across runtimes.
func boundedInteger(v any) (int, bool) {
	var f float64
	switch x := v.(type) {
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return 0, false
		}
		f = float64(n)
	case float64:
		f = x
	case int:
		f = float64(x)
	default:
		return 0, false
	}
	return int(f), !math.IsNaN(f) && !math.IsInf(f, 0) && math.Trunc(f) == f && math.Abs(f) <= 1000000
}
func validFieldDefinition(v any, v2 bool) bool {
	f, err := object(v, "type enum items maxItems uniqueItems minimum maximum step maxLength")
	if err != nil {
		return false
	}
	switch f["type"] {
	case "string":
		if _, hasEnum := f["enum"]; hasEnum {
			return len(f) == 2 && stringsList(f["enum"], 13)
		}
		max, ok := boundedInteger(f["maxLength"])
		return v2 && len(f) == 2 && ok && max >= 1 && max <= 2000
	case "array":
		item, err := object(f["items"], "type enum")
		max, ok := boundedInteger(f["maxItems"])
		if err != nil || len(item) != 2 || item["type"] != "string" || !stringsList(item["enum"], 12) || len(f) != 4 || !ok || max < 1 || max > 12 || f["uniqueItems"] != true {
			return false
		}
		for _, v := range item["enum"].([]any) {
			if !id(v) {
				return false
			}
		}
		return true
	case "integer":
		min, a := boundedInteger(f["minimum"])
		max, b := boundedInteger(f["maximum"])
		step, c := boundedInteger(f["step"])
		return v2 && len(f) == 4 && a && b && c && min < max && step > 0 && (max-min)%step == 0
	}
	return false
}
func validExtendedWriter(n Element, f Field) bool {
	switch n.Type {
	case "Slider":
		return f.Type == "integer"
	case "TextInput":
		return f.Type == "string" && f.Enum == nil && f.MaxLength != nil
	case "Ranking":
		options := n.Props["options"].([]any)
		if f.Type != "array" || f.Items == nil || len(options) < 2 || f.MaxItems != len(options) || len(f.Items.Enum) != len(options) {
			return false
		}
		for _, option := range options {
			found := false
			for _, value := range f.Items.Enum {
				if value == option.(map[string]any)["value"] {
					found = true
				}
			}
			if !found {
				return false
			}
		}
		return true
	}
	return false
}
func (d Definition) validExtendedReader(n Element) bool {
	if n.Type == "TextPreview" {
		binding := n.Props["value"].(map[string]any)["$bindState"]
		for _, writer := range d.Spec.Elements {
			if writer.Type == "TextInput" && writer.Props["value"].(map[string]any)["$bindState"] == binding {
				return true
			}
		}
		return false
	}
	if n.Type == "AllocationSummary" {
		total, ok := boundedInteger(n.Props["total"])
		if !ok || total < 0 {
			return false
		}
		for _, binding := range n.Props["paths"].([]any) {
			found := false
			for _, writer := range d.Spec.Elements {
				writerUnit, _ := writer.Props["unit"].(string)
				summaryUnit, _ := n.Props["unit"].(string)
				if writer.Type == "Slider" && writer.Props["value"].(map[string]any)["$bindState"] == binding && writerUnit == summaryUnit {
					found = true
				}
			}
			if !found {
				return false
			}
		}
	}
	return true
}

// Allocations is the host-owned allocation-sum-v1 calculation recorded on submission.
func (d Definition) Allocations(values map[string]any) map[string]any {
	results := map[string]any{}
	for key, n := range d.Spec.Elements {
		if n.Type != "AllocationSummary" {
			continue
		}
		inputs := map[string]any{}
		sum := 0
		for _, binding := range n.Props["paths"].([]any) {
			field := path(binding)
			value, _ := boundedInteger(values[field])
			inputs[field] = value
			sum += value
		}
		total, _ := boundedInteger(n.Props["total"])
		unit, _ := n.Props["unit"].(string)
		results[key] = map[string]any{"calculation": "allocation-sum-v1", "inputs": inputs, "total": total, "sum": sum, "remaining": total - sum, "unit": unit}
	}
	return results
}
func (d Definition) valueLabels(values map[string]any) []string {
	labels := []string{}
	for _, field := range sortedKeys(values) {
		for _, n := range d.Spec.Elements {
			if n.Type != "Choice" && n.Type != "Ranking" && n.Type != "Slider" && n.Type != "TextInput" {
				continue
			}
			if path(n.Props["value"].(map[string]any)["$bindState"]) != field {
				continue
			}
			label, _ := n.Props["label"].(string)
			if label == "" {
				label = field
			}
			switch n.Type {
			case "Slider":
				value, _ := boundedInteger(values[field])
				unit, _ := n.Props["unit"].(string)
				labels = append(labels, strings.TrimSpace(fmt.Sprintf("%s: %d %s", label, value, unit)))
			case "TextInput":
				labels = append(labels, label+": "+values[field].(string))
			default:
				selected := []any{values[field]}
				if a, ok := values[field].([]any); ok {
					selected = a
				}
				items := []string{}
				for _, value := range selected {
					for _, option := range n.Props["options"].([]any) {
						o := option.(map[string]any)
						if o["value"] == value {
							items = append(items, o["label"].(string))
						}
					}
				}
				separator := ", "
				if n.Type == "Ranking" {
					separator = " > "
				}
				labels = append(labels, label+": "+strings.Join(items, separator))
			}
		}
	}
	return labels
}
