package interactive

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type ValidationError struct{ Path, Reason string }

func (e *ValidationError) Error() string {
	return fmt.Sprintf("Interactive card %s: %s", e.Path, e.Reason)
}
func (e *ValidationError) Unwrap() error  { return ErrInvalid }
func invalidAt(path, reason string) error { return &ValidationError{path, reason} }
func stringValue(v any) string            { s, _ := v.(string); return s }
func numberOr(v any, fallback int) int {
	if n, ok := boundedInteger(v); ok {
		return n
	}
	return fallback
}
func cloneMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

var inputComponentRules = func() map[string]map[string]string {
	var catalog struct{ Components map[string]map[string]string }
	if err := json.Unmarshal([]byte(CatalogV3JSON), &catalog); err != nil {
		panic("invalid bundled card catalog")
	}
	return catalog.Components
}()

type normalizer struct {
	extras         map[string][]string
	elements       map[string]Element
	schema         map[string]Field
	state          map[string]any
	sourceElements map[string]any
	sourceSchema   map[string]any
	sourceState    map[string]any
	optionIDs      map[string]map[string]string
	aliases        map[string]string
	fields         map[string]string
	elementFields  map[string]string
	reserved       map[string]bool
	visited        map[string]bool
	count          int
	paths          []any
	continues      int
}

// Normalize is the permissive model-input adapter. Parse remains strict for storage.
func Normalize(raw []byte) (Definition, error) {
	v, err := decodeModelJSON(raw)
	if err != nil {
		return Definition{}, invalidAt("/", "invalid, duplicate-key, oversized, or incomplete JSON")
	}
	m, ok := v.(map[string]any)
	if !ok {
		return Definition{}, invalidAt("/", "expected an object")
	}
	n := normalizer{extras: map[string][]string{}, elements: map[string]Element{}, schema: map[string]Field{}, state: map[string]any{}, optionIDs: map[string]map[string]string{}, aliases: map[string]string{}, fields: map[string]string{}, elementFields: map[string]string{}, reserved: map[string]bool{}, visited: map[string]bool{}}
	var root string
	var title string
	local := m["continue"] == false
	if marker, ok := boundedInteger(m["cove_ui"]); ok && marker == 1 {
		title = stringValue(m["title"])
		if title == "REPLACE_WITH_TOPIC" {
			return Definition{}, invalidAt("/title", "replace guide placeholders with conversation-specific content")
		}
		if title == "" {
			title = "Interactive reply"
		}
		children, ok := m["children"].([]any)
		if !ok {
			return Definition{}, invalidAt("/children", "expected nested components")
		}
		ids := []string{}
		for i, child := range children {
			id, err := n.node(child, "", fmt.Sprintf("/children/%d", i), 2)
			if err != nil {
				return Definition{}, err
			}
			ids = append(ids, id)
			ids = append(ids, n.extras[id]...)
		}
		root = "root"
		n.elements[root] = Element{Type: "Card", Props: map[string]any{"title": title}, Children: ids}
	} else {
		version := stringValue(m["version"])
		if version != "cove-card-v1" && version != "cove-card-v2" && version != "cove-card-v3" {
			return Definition{}, invalidAt("/version", "expected a supported version or cove_ui:1")
		}
		if catalog := stringValue(m["catalogVersion"]); catalog != "" && catalog != "cove-interactive-v1" && catalog != "cove-interactive-v2" && catalog != "cove-interactive-v3" {
			return Definition{}, invalidAt("/catalogVersion", "unsupported catalog")
		}
		spec := cloneMap(m["spec"])
		n.sourceElements = cloneMap(spec["elements"])
		for key := range n.sourceElements {
			n.reserved[key] = true
		}
		n.sourceSchema = cloneMap(m["stateSchema"])
		n.sourceState = cloneMap(spec["state"])
		root = stringValue(spec["root"])
		if !id(root) {
			return Definition{}, invalidAt("/spec/root", "expected an element identifier")
		}
		var err error
		root, err = n.node(n.sourceElements[root], root, "/spec/elements/"+root, 1)
		if err != nil {
			return Definition{}, err
		}
		title = stringValue(n.elements[root].Props["title"])
		if n.elements[root].Type != "Card" {
			return Definition{}, invalidAt("/spec/root", "root must be Card")
		}
		local = version == "cove-card-v3" && n.continues == 0
	}
	// Resolve reader bindings and feedback after all writers are known.
	for key, node := range n.elements {
		if node.Type == "TextPreview" {
			binding := stringValue(node.Props["field"])
			delete(node.Props, "field")
			if binding != "" {
				field := n.fieldRef(binding)
				if field == "" {
					return Definition{}, invalidAt("/elements/"+key+"/field", "unknown TextInput")
				}
				node.Props["value"] = map[string]any{"$bindState": "/" + field}
			}
		}
		if node.Type == "AllocationSummary" {
			if refs, ok := node.Props["fields"].([]any); ok {
				paths := []any{}
				for _, ref := range refs {
					field := n.fieldRef(stringValue(ref))
					if field == "" {
						return Definition{}, invalidAt("/elements/"+key+"/fields", "unknown Slider")
					}
					paths = append(paths, "/"+field)
				}
				delete(node.Props, "fields")
				node.Props["paths"] = paths
			}
		}
		if node.Type == "Feedback" {
			source := stringValue(node.Props["choiceElement"])
			if mapped := n.aliases[source]; mapped != "" {
				source = mapped
			}
			node.Props["choiceElement"] = source
			options := n.optionIDs[source]
			cases, ok := node.Props["cases"].([]any)
			if !ok {
				return Definition{}, invalidAt("/elements/"+key+"/cases", "expected answer feedback")
			}
			clean := []any{}
			for _, item := range cases {
				c := cloneMap(item)
				mapped := options[stringValue(c["value"])]
				if mapped == "" {
					return Definition{}, invalidAt("/elements/"+key+"/cases", "unknown answer value")
				}
				clean = append(clean, map[string]any{"value": mapped, "outcome": c["outcome"], "text": c["text"]})
			}
			node.Props["cases"] = clean
		}
		if a, ok := node.On["press"]; ok && a.Action == "continue_chat" {
			if _, declared := a.Params["paths"]; !declared {
				a.Params["paths"] = n.paths
				node.On["press"] = a
			}
		}
		n.elements[key] = node
	}
	if local && n.continues > 0 {
		return Definition{}, invalidAt("/continue", "a local-only card cannot contain a continuation action")
	}
	if n.continues == 0 && !local && len(n.paths) > 0 {
		key := n.fresh("continue")
		label := stringValue(m["continue"])
		if label == "" {
			label = "Continue"
		}
		n.elements[key] = Element{Type: "Button", Props: map[string]any{"label": label}, Children: []string{}, On: map[string]Action{"press": {Action: "continue_chat", Params: map[string]any{"paths": n.paths}}}}
		r := n.elements[root]
		r.Children = append(r.Children, key)
		n.elements[root] = r
		n.continues++
	}
	version, catalog := "cove-card-v2", "cove-interactive-v2"
	if m["version"] == "cove-card-v1" && m["catalogVersion"] == "cove-interactive-v1" {
		legacy := true
		for _, node := range n.elements {
			switch node.Type {
			case "Ranking", "Slider", "TextInput", "TextPreview", "AllocationSummary":
				legacy = false
			}
		}
		if legacy {
			version, catalog = "cove-card-v1", "cove-interactive-v1"
		}
	}
	if local || n.continues == 0 {
		version, catalog = "cove-card-v3", "cove-interactive-v3"
	}
	fallback := stringValue(m["fallback"])
	if !text(fallback) {
		fallback = title
	}
	if !text(fallback) {
		fallback = "Interactive reply"
	}
	d := Definition{Version: version, CatalogVersion: catalog, Fallback: fallback, StateSchema: n.schema, Spec: Spec{Root: root, State: n.state, Elements: n.elements}}
	b, err := json.Marshal(d)
	if err != nil {
		return Definition{}, invalidAt("/", "cannot encode normalized definition")
	}
	parsed, err := Parse(b)
	if err != nil {
		for _, key := range sortedElementIDs(d) {
			node := d.Spec.Elements[key]
			names := make([]string, 0, len(inputComponentRules[node.Type]))
			for name := range inputComponentRules[node.Type] {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				rule := inputComponentRules[node.Type][name]
				v, exists := node.Props[name]
				if (!exists && strings.HasSuffix(rule, "!")) || (exists && !validateRule(v, rule)) {
					return Definition{}, invalidAt("/elements/"+key+"/props/"+name, "expected "+strings.TrimSuffix(rule, "!"))
				}
			}
		}
		return Definition{}, invalidAt("/state", "inconsistent bindings, values, bounds, or actions")
	}
	return parsed, nil
}
func (n *normalizer) fresh(prefix string) string {
	for i := 0; ; i++ {
		key := fmt.Sprintf("%s_%d", prefix, i)
		if _, ok := n.elements[key]; !ok && !n.reserved[key] {
			n.elements[key] = Element{}
			return key
		}
	}
}

func (n *normalizer) fieldRef(ref string) string {
	if field := n.elementFields[ref]; field != "" {
		return field
	}
	return n.fields[ref]
}
func (n *normalizer) node(value any, key, location string, depth int) (string, error) {
	if depth > 4 || n.count >= 29 {
		return "", invalidAt(location, "component depth or count exceeded")
	}
	m, ok := value.(map[string]any)
	if !ok {
		return "", invalidAt(location, "expected a component")
	}
	if key != "" {
		if n.visited[key] {
			return "", invalidAt(location, "cycle or duplicate child")
		}
		n.visited[key] = true
	} else {
		key = n.fresh("element")
	}
	n.count++
	props := cloneMap(m["props"])
	if _, nested := m["props"]; !nested {
		props = m
	}
	typ := stringValue(m["type"])
	rules, known := inputComponentRules[typ]
	if !known {
		return "", invalidAt(location+"/type", "unsupported component")
	}
	p := map[string]any{}
	for k := range rules {
		if v, ok := props[k]; ok {
			p[k] = v
		}
	}
	node := Element{Type: typ, Props: p, Children: []string{}}
	rawID := stringValue(m["id"])
	if rawID != "" {
		if n.aliases[rawID] != "" {
			return "", invalidAt(location+"/id", "duplicate component id")
		}
		n.aliases[rawID] = key
	}
	if typ == "Card" || typ == "Reveal" {
		children, exists := m["children"]
		if exists {
			list, ok := children.([]any)
			if !ok {
				return "", invalidAt(location+"/children", "expected an array")
			}
			for i, child := range list {
				childKey := ""
				if ref, ok := child.(string); ok {
					childKey = ref
					child = n.sourceElements[ref]
				}
				id, err := n.node(child, childKey, fmt.Sprintf("%s/children/%d", location, i), depth+1)
				if err != nil {
					return "", err
				}
				node.Children = append(node.Children, id)
				node.Children = append(node.Children, n.extras[id]...)
			}
		}
	}
	if typ == "Text" && p["content"] == nil {
		p["content"] = props["text"]
	}
	if typ == "Choice" || typ == "Ranking" || typ == "Slider" || typ == "TextInput" {
		binding := path(cloneMap(p["value"])["$bindState"])
		if binding == "" {
			binding = fmt.Sprintf("field_%d", n.count)
		}
		p["value"] = map[string]any{"$bindState": "/" + binding}
		if n.schema[binding].Type != "" {
			return "", invalidAt(location+"/value", "field has more than one writer")
		}
		if rawID != "" {
			n.elementFields[rawID] = binding
		}
		n.fields[binding] = binding
		original := n.sourceState[binding]
		if original == nil {
			original = props["initial"]
			if original == nil {
				if _, isBinding := props["value"].(map[string]any); !isBinding {
					original = props["value"]
				}
			}
		}
		field := Field{}
		oldField := cloneMap(n.sourceSchema[binding])
		for _, name := range []string{"min", "max", "step", "maxLength", "maxItems"} {
			if v, present := props[name]; present {
				if _, ok := boundedInteger(v); !ok {
					return "", invalidAt(location+"/"+name, "expected a bounded integer")
				}
			}
		}
		for _, name := range []string{"minimum", "maximum", "step", "maxLength", "maxItems"} {
			if v, present := oldField[name]; present {
				if _, ok := boundedInteger(v); !ok {
					return "", invalidAt(location+"/schema/"+name, "expected a bounded integer")
				}
			}
		}

		switch typ {
		case "Choice", "Ranking":
			options, ok := props["options"].([]any)
			if !ok || len(options) < 1 || len(options) > 12 {
				return "", invalidAt(location+"/options", "expected 1 to 12 options")
			}
			clean, values := []any{}, []string{}
			mapping := map[string]string{}
			reserved, used := map[string]bool{}, map[string]bool{}
			for _, option := range options {
				o := cloneMap(option)
				raw := stringValue(o["value"])
				if s, ok := option.(string); ok {
					raw = s
				} else if raw == "" {
					raw = stringValue(o["label"])
				}
				if id(raw) {
					reserved[raw] = true
				}
			}
			for i, option := range options {
				o := cloneMap(option)
				if s, ok := option.(string); ok {
					o = map[string]any{"value": s, "label": s}
				}
				label := stringValue(o["label"])
				raw := stringValue(o["value"])
				if raw == "" {
					raw = label
				}
				if !text(label) || raw == "" || mapping[raw] != "" {
					return "", invalidAt(location+"/options", "labels and distinct values are required")
				}
				canonical := fmt.Sprintf("option_%d", i+1)
				if id(raw) {
					canonical = raw
				} else {
					base := canonical
					for suffix := 1; reserved[canonical] || used[canonical]; suffix++ {
						canonical = fmt.Sprintf("%s_%d", base, suffix)
					}
				}
				used[canonical] = true
				mapping[raw] = canonical
				values = append(values, canonical)
				item := map[string]any{"value": canonical, "label": label}
				if text(o["description"]) {
					item["description"] = o["description"]
				}
				clean = append(clean, item)
			}
			n.optionIDs[key] = mapping
			p["options"] = clean
			if typ == "Choice" {
				if p["mode"] == nil {
					p["mode"] = "single"
				}
				if p["required"] == nil {
					p["required"] = false
				}
			}
			if typ == "Choice" && p["mode"] == "single" {
				field = Field{Type: "string", Enum: append([]string{""}, values...)}
				initial := ""
				if s, ok := original.(string); ok && s != "" {
					initial = mapping[s]
					if initial == "" {
						return "", invalidAt(location+"/initial", "unknown option")
					}
				}
				n.state[binding] = initial
			} else {
				max := numberOr(oldField["maxItems"], numberOr(props["maxItems"], len(values)))
				field = Field{Type: "array", Items: &Field{Type: "string", Enum: values}, UniqueItems: true, MaxItems: max}
				initial := []any{}
				if list, ok := original.([]any); ok {
					for _, v := range list {
						mapped := mapping[stringValue(v)]
						if mapped == "" {
							return "", invalidAt(location+"/initial", "unknown option")
						}
						initial = append(initial, mapped)
					}
				}
				if typ == "Ranking" && len(initial) == 0 {
					for _, v := range values {
						initial = append(initial, v)
					}
				}
				n.state[binding] = initial
			}
		case "Slider":
			min := numberOr(oldField["minimum"], numberOr(props["min"], 0))
			max := numberOr(oldField["maximum"], numberOr(props["max"], 100))
			step := numberOr(oldField["step"], numberOr(props["step"], 1))
			field = Field{Type: "integer", Minimum: &min, Maximum: &max, Step: &step}
			if min >= max || step <= 0 || (max-min)%step != 0 {
				return "", invalidAt(location+"/bounds", "invalid min, max, or step")
			}
			if original == nil {
				original = min
			}
			value, ok := boundedInteger(original)
			if !ok {
				return "", invalidAt(location+"/value", "expected a bounded integer")
			}
			// Snap initial model values only; saved state and later edits stay strict.
			if value < min {
				value = min
			}
			if value > max {
				value = max
			}
			n.state[binding] = min + ((value-min+step/2)/step)*step
		case "TextInput":
			max := numberOr(oldField["maxLength"], numberOr(props["maxLength"], 1000))
			field = Field{Type: "string", MaxLength: &max}
			if original == nil {
				original = ""
			}
			n.state[binding] = original
			if p["required"] == nil {
				p["required"] = false
			}
		}
		if p["label"] == nil && typ != "Choice" {
			p["label"] = map[string]string{"Slider": "Value", "Ranking": "Order", "TextInput": "Text"}[typ]
		}
		n.schema[binding] = field
		n.paths = append(n.paths, "/"+binding)
	}
	if typ == "Choice" && props["answer"] != nil {
		answer := stringValue(props["answer"])
		mapping := n.optionIDs[key]
		if mapping[answer] == "" {
			return "", invalidAt(location+"/answer", "answer must match an option value")
		}
		feedbackID := n.fresh("feedback")
		buttonID := n.fresh("check")
		cases := []any{}
		for _, option := range props["options"].([]any) {
			o := cloneMap(option)
			raw := stringValue(o["value"])
			if raw == "" {
				if s, ok := option.(string); ok {
					raw = s
				} else {
					raw = stringValue(o["label"])
				}
			}
			outcome, message := "incorrect", "Try again."
			if raw == answer {
				outcome = "correct"
				message = stringValue(props["explanation"])
				if message == "" {
					message = "Correct."
				}
			}
			cases = append(cases, map[string]any{"value": raw, "outcome": outcome, "text": message})
		}
		n.elements[feedbackID] = Element{Type: "Feedback", Props: map[string]any{"choiceElement": key, "cases": cases}, Children: []string{}}
		n.elements[buttonID] = Element{Type: "Button", Props: map[string]any{"label": "Check answer"}, Children: []string{}, On: map[string]Action{"press": {Action: "check_answer", Params: map[string]any{"feedbackElement": feedbackID}}}}
		n.extras[key] = []string{buttonID, feedbackID}
	}
	if typ == "AllocationSummary" && props["fields"] != nil {
		p["fields"] = props["fields"]
	}
	if typ == "TextPreview" && props["field"] != nil {
		p["field"] = props["field"]
	}
	if typ == "Button" {
		on := cloneMap(m["on"])
		action := cloneMap(on["press"])
		name := stringValue(action["action"])
		if name == "" {
			name = stringValue(props["action"])
		}
		if name != "continue_chat" && name != "reset" && name != "check_answer" {
			return "", invalidAt(location+"/action", "unsupported action")
		}
		node.On = map[string]Action{"press": {Action: name, Params: cloneMap(action["params"])}}
		if name == "continue_chat" {
			n.continues++
		}
	}
	n.elements[key] = node
	return key, nil
}

// Stable ordering makes diagnostics and fixtures independent of map iteration.
func sortedElementIDs(d Definition) []string {
	ids := make([]string, 0, len(d.Spec.Elements))
	for id := range d.Spec.Elements {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
func (d Definition) HasContinuation() bool {
	for _, n := range d.Spec.Elements {
		if n.On["press"].Action == "continue_chat" {
			return true
		}
	}
	return false
}
func markedUI(raw []byte) bool {
	v, err := decodeModelJSON(raw)
	if err != nil {
		return partialUIMarker.Match(raw)
	}
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	if n, ok := boundedInteger(m["cove_ui"]); ok && n == 1 {
		return true
	}
	return strings.HasPrefix(stringValue(m["version"]), "cove-card-v")
}
