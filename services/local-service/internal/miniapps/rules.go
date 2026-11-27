package miniapps

import (
	"math"
	"strings"
	"time"
)

// Return the compatible field types of a bounded update expression. ISO date
// literals can appear in either text or date expressions.
type typeSet uint8

const (
	numberType typeSet = 1 << iota
	textType
	dateType
	boolType
)

func fieldType(t string) typeSet {
	switch t {
	case "number":
		return numberType
	case "text":
		return textType
	case "date":
		return dateType
	case "bool":
		return boolType
	}
	return 0
}
func operator(v map[string]any) (string, []any) {
	if len(v) == 1 {
		for k, args := range v {
			list, _ := args.([]any)
			return k, list
		}
	}
	return "", nil
}
func ruleTypes(v any, fields, inputs map[string]string, depth int) typeSet {
	if depth > 6 {
		return 0
	}
	switch value := v.(type) {
	case map[string]any:
		op, args := operator(value)
		if op == "if" {
			if len(args) != 3 || ruleTypes(args[0], fields, inputs, depth+1)&boolType == 0 {
				return 0
			}
			return ruleTypes(args[1], fields, inputs, depth+1) & ruleTypes(args[2], fields, inputs, depth+1)
		}
		if len(args) != 2 {
			return 0
		}
		common := ruleTypes(args[0], fields, inputs, depth+1) & ruleTypes(args[1], fields, inputs, depth+1)
		switch op {
		case "add":
			return common & numberType
		case "eq", "ne":
			if common != 0 {
				return boolType
			}
		case "lt", "lte", "gt", "gte":
			if common&^boolType != 0 {
				return boolType
			}
		}
	case string:
		if name, ok := strings.CutPrefix(value, "$record."); ok {
			return fieldType(fields[name])
		}
		if name, ok := strings.CutPrefix(value, "$input."); ok {
			return fieldType(inputs[name])
		}
		if dayOffset.MatchString(value) {
			return dateType
		}
		if strings.HasPrefix(value, "$") || !matches(value, "text") {
			return 0
		}
		if matches(value, "date") {
			return textType | dateType
		}
		return textType
	case bool:
		return boolType
	case float64:
		if matches(value, "number") {
			return numberType
		}
	}
	return 0
}
func evalRule(v any, fields, inputs map[string]any, now time.Time) (any, error) {
	if s, ok := v.(string); ok {
		if name, ok := strings.CutPrefix(s, "$record."); ok {
			return fields[name], nil
		}
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return resolve(v, inputs, now), nil
	}
	op, args := operator(obj)
	left, err := evalRule(args[0], fields, inputs, now)
	if err != nil {
		return nil, err
	}
	if op == "if" {
		if left.(bool) {
			return evalRule(args[1], fields, inputs, now)
		}
		return evalRule(args[2], fields, inputs, now)
	}
	right, err := evalRule(args[1], fields, inputs, now)
	if err != nil {
		return nil, err
	}
	if op == "add" {
		sum := left.(float64) + right.(float64)
		if math.IsInf(sum, 0) || math.IsNaN(sum) {
			return nil, invalid("numeric result exceeds range")
		}
		return sum, nil
	}
	return comparison(compare(left, right), op), nil
}
func comparison(order int, op string) bool {
	switch op {
	case "eq":
		return order == 0
	case "ne":
		return order != 0
	case "lt":
		return order < 0
	case "lte":
		return order <= 0
	case "gt":
		return order > 0
	case "gte":
		return order >= 0
	}
	return false
}
