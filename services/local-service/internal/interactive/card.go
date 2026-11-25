// Package interactive defines the bounded, data-only interactive card contract.
package interactive

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

//go:embed catalog.json
var CatalogJSON string

//go:embed catalog-v2.json
var CatalogV2JSON string

//go:embed catalog-v3.json
var CatalogV3JSON string
var ErrInvalid = errors.New("interactive card is invalid or unsupported")
var unfencedUI = regexp.MustCompile(`^[ \t]*\{[ \t\r\n]*"cove_ui"[ \t\r\n]*:[ \t\r\n]*1(?:[,} \t\r\n]|$)`)
var partialUIMarker = regexp.MustCompile(`^[ \t\r\n]*\{[ \t\r\n]*"(?:cove_ui"[ \t\r\n]*:[ \t\r\n]*1(?:[,} \t\r\n]|$)|version"[ \t\r\n]*:[ \t\r\n]*"cove-card-v)`)
var openingFence = regexp.MustCompile("^(`{3,}|~{3,})(.*)$")
var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var fieldIdentifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

type Definition struct {
	Version        string           `json:"version"`
	CatalogVersion string           `json:"catalogVersion"`
	Fallback       string           `json:"fallback"`
	StateSchema    map[string]Field `json:"stateSchema"`
	Spec           Spec             `json:"spec"`
}
type Field struct {
	Type        string   `json:"type"`
	Enum        []string `json:"enum,omitempty"`
	Items       *Field   `json:"items,omitempty"`
	MaxItems    int      `json:"maxItems,omitempty"`
	UniqueItems bool     `json:"uniqueItems,omitempty"`
	Minimum     *int     `json:"minimum,omitempty"`
	Maximum     *int     `json:"maximum,omitempty"`
	Step        *int     `json:"step,omitempty"`
	MaxLength   *int     `json:"maxLength,omitempty"`
}
type Spec struct {
	Root     string             `json:"root"`
	State    map[string]any     `json:"state"`
	Elements map[string]Element `json:"elements"`
}
type Element struct {
	Type     string            `json:"type"`
	Props    map[string]any    `json:"props"`
	Children []string          `json:"children"`
	On       map[string]Action `json:"on,omitempty"`
}
type Action struct {
	Action string         `json:"action"`
	Params map[string]any `json:"params"`
}
type Submission struct {
	Intent       string            `json:"intent,omitempty"`
	GenerationID string            `json:"generation_id"`
	Revision     int64             `json:"revision"`
	Values       map[string]any    `json:"values"`
	Checks       map[string]string `json:"checks"`
}
type Run struct {
	GenerationID     string            `json:"generation_id"`
	Definition       Definition        `json:"definition"`
	Values           map[string]any    `json:"values"`
	Checks           map[string]string `json:"checks"`
	Revision         int64             `json:"revision"`
	SubmittedBatchID string            `json:"submitted_batch_id,omitempty"`
	CanContinue      bool              `json:"can_continue"`
}

// Decode rejects duplicate keys, excess nesting, trailing data, and invalid Unicode.
func Decode(raw []byte) (any, error) {
	if len(raw) > 32768 || !utf8.Valid(raw) {
		return nil, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var read func(int) (any, error)
	read = func(depth int) (any, error) {
		if depth > 16 {
			return nil, ErrInvalid
		}
		t, e := d.Token()
		if e != nil {
			return nil, ErrInvalid
		}
		switch x := t.(type) {
		case json.Delim:
			if x == '{' {
				m := map[string]any{}
				for d.More() {
					k, e := d.Token()
					if e != nil {
						return nil, ErrInvalid
					}
					key, ok := k.(string)
					if !ok {
						return nil, ErrInvalid
					}
					if _, ok = m[key]; ok {
						return nil, ErrInvalid
					}
					v, e := read(depth + 1)
					if e != nil {
						return nil, e
					}
					m[key] = v
				}
				end, e := d.Token()
				if e != nil || end != json.Delim('}') {
					return nil, ErrInvalid
				}
				return m, nil
			}
			if x == '[' {
				a := []any{}
				for d.More() {
					v, e := read(depth + 1)
					if e != nil {
						return nil, e
					}
					a = append(a, v)
				}
				end, e := d.Token()
				if e != nil || end != json.Delim(']') {
					return nil, ErrInvalid
				}
				return a, nil
			}
			return nil, ErrInvalid
		case string:
			// encoding/json replaces invalid surrogate sequences. Conservatively reject
			// replacement characters too, keeping both validators deterministic.
			if strings.ContainsRune(x, '\ufffd') {
				return nil, ErrInvalid
			}
			return x, nil
		case json.Number:
			if _, e := strconv.ParseInt(string(x), 10, 64); e != nil {
				return nil, ErrInvalid
			}
			return x, nil
		default:
			return t, nil
		}
	}
	v, e := read(0)
	if e != nil {
		return nil, e
	}
	if _, e = d.Token(); e != io.EOF {
		return nil, ErrInvalid
	}
	return v, nil
}
func object(v any, allowed string) (map[string]any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, ErrInvalid
	}
	for k := range m {
		matched := false
		for _, name := range strings.Fields(allowed) {
			if k == name {
				matched = true
				break
			}
		}
		if !matched {
			return nil, ErrInvalid
		}
	}
	return m, nil
}
func text(v any) bool {
	s, ok := v.(string)
	return ok && strings.TrimSpace(s) != "" && utf8.RuneCountInString(s) > 0 && utf8.RuneCountInString(s) <= 2000 && !strings.ContainsRune(s, '\ufffd')
}
func id(v any) bool {
	s, ok := v.(string)
	return ok && identifier.MatchString(s) && s != "constructor" && s != "prototype"
}
func list(v any) ([]any, bool) { a, ok := v.([]any); return a, ok }
func stringsList(v any, max int) bool {
	a, ok := list(v)
	if !ok || len(a) == 0 || len(a) > max {
		return false
	}
	seen := map[string]bool{}
	for _, v := range a {
		s, ok := v.(string)
		if !ok || seen[s] {
			return false
		}
		seen[s] = true
	}
	return true
}
func validateRule(v any, rule string) bool {
	switch strings.TrimSuffix(rule, "!") {
	case "text":
		return text(v)
	case "id":
		return id(v)
	case "integer":
		_, ok := boundedInteger(v)
		return ok
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "mode":
		return v == "single" || v == "multiple"
	case "binding":
		m, e := object(v, "$bindState")
		return e == nil && len(m) == 1 && path(m["$bindState"]) != ""
	case "paths":
		if !stringsList(v, 16) {
			return false
		}
		for _, p := range v.([]any) {
			if path(p) == "" {
				return false
			}
		}
		return true
	case "options", "cases":
		a, ok := list(v)
		if !ok || len(a) < 1 || len(a) > 12 {
			return false
		}
		seen := map[string]bool{}
		for _, item := range a {
			allowed := "value label description"
			if strings.HasPrefix(rule, "cases") {
				allowed = "value outcome text"
			}
			m, e := object(item, allowed)
			if e != nil || !id(m["value"]) {
				return false
			}
			key := m["value"].(string)
			if seen[key] {
				return false
			}
			seen[key] = true
			if strings.HasPrefix(rule, "cases") {
				if !text(m["text"]) || (m["outcome"] != "correct" && m["outcome"] != "incorrect") {
					return false
				}
			} else {
				if !text(m["label"]) {
					return false
				}
				if desc, ok := m["description"]; ok && !text(desc) {
					return false
				}
			}
		}
		return true
	}
	return false
}
func path(v any) string {
	s, ok := v.(string)
	if !ok || !strings.HasPrefix(s, "/") {
		return ""
	}
	s = s[1:]
	if !fieldIdentifier.MatchString(s) || s == "constructor" || s == "prototype" {
		return ""
	}
	return s
}
func rules(v any, spec map[string]string) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	for k, v := range m {
		rule, ok := spec[k]
		if !ok || !validateRule(v, rule) {
			return false
		}
	}
	for k, r := range spec {
		if strings.HasSuffix(r, "!") {
			if _, ok := m[k]; !ok {
				return false
			}
		}
	}
	return true
}
func Parse(raw []byte) (Definition, error) {
	var result Definition
	v, e := Decode(raw)
	if e != nil {
		return result, e
	}
	m, e := object(v, "version catalogVersion fallback stateSchema spec")
	if e != nil || len(m) != 5 || !((m["version"] == "cove-card-v1" && m["catalogVersion"] == "cove-interactive-v1") || (m["version"] == "cove-card-v2" && m["catalogVersion"] == "cove-interactive-v2") || (m["version"] == "cove-card-v3" && m["catalogVersion"] == "cove-interactive-v3")) || !text(m["fallback"]) {
		return result, ErrInvalid
	}
	fields, ok := m["stateSchema"].(map[string]any)
	if !ok {
		return result, ErrInvalid
	}
	for _, v := range fields {
		if !validFieldDefinition(v, m["version"] != "cove-card-v1") {
			return result, ErrInvalid
		}
	}
	var catalog struct {
		Components map[string]map[string]string `json:"components"`
		Actions    map[string]map[string]string `json:"actions"`
	}
	catalogJSON := CatalogJSON
	if m["version"] == "cove-card-v2" {
		catalogJSON = CatalogV2JSON
	}
	if m["version"] == "cove-card-v3" {
		catalogJSON = CatalogV3JSON
	}
	if json.Unmarshal([]byte(catalogJSON), &catalog) != nil {
		panic("invalid bundled card catalog")
	}
	spec, e := object(m["spec"], "root state elements")
	if e != nil || len(spec) != 3 || !id(spec["root"]) {
		return result, ErrInvalid
	}
	elements, ok := spec["elements"].(map[string]any)
	if !ok || len(elements) > 30 || len(elements) == 0 {
		return result, ErrInvalid
	}
	for key, value := range elements {
		if !id(key) {
			return result, ErrInvalid
		}
		n, e := object(value, "type props children on")
		if e != nil {
			return result, e
		}
		typ, ok := n["type"].(string)
		if !ok {
			return result, ErrInvalid
		}
		r, ok := catalog.Components[typ]
		if !ok || !rules(n["props"], r) {
			return result, ErrInvalid
		}
		children, ok := list(n["children"])
		if !ok {
			return result, ErrInvalid
		}
		for _, c := range children {
			if !id(c) {
				return result, ErrInvalid
			}
		}
		if typ != "Card" && typ != "Reveal" && len(children) > 0 {
			return result, ErrInvalid
		}
		if _, exists := n["on"]; typ == "Button" && !exists {
			return result, ErrInvalid
		}
		if on, exists := n["on"]; exists {
			events, e := object(on, "press")
			if e != nil || typ != "Button" || len(events) != 1 {
				return result, ErrInvalid
			}
			a, e := object(events["press"], "action params")
			if e != nil || len(a) != 2 {
				return result, ErrInvalid
			}
			name, ok := a["action"].(string)
			if !ok {
				return result, ErrInvalid
			}
			r, ok := catalog.Actions[name]
			if !ok || !rules(a["params"], r) {
				return result, ErrInvalid
			}
		}
	}
	b, _ := json.Marshal(v)
	if json.Unmarshal(b, &result) != nil {
		return result, ErrInvalid
	}
	if e = result.validateTree(); e != nil {
		return Definition{}, e
	}
	return result, nil
}
func (d Definition) Validate() error {
	raw, err := json.Marshal(d)
	if err != nil {
		return ErrInvalid
	}
	_, err = Parse(raw)
	return err
}
func (d Definition) validateTree() error {
	if d.Spec.Elements[d.Spec.Root].Type != "Card" || (d.Version != "cove-card-v3" && len(d.StateSchema) == 0) || len(d.StateSchema) > 16 || len(d.Spec.State) != len(d.StateSchema) {
		return ErrInvalid
	}
	visited := map[string]bool{}
	writers := map[string]Element{}
	continues := 0
	submitted := map[string]bool{}
	var visit func(string, int) error
	visit = func(key string, depth int) error {
		n, ok := d.Spec.Elements[key]
		if !ok || visited[key] || depth > 4 {
			return ErrInvalid
		}
		visited[key] = true
		if n.Type == "Card" && key != d.Spec.Root {
			return ErrInvalid
		}
		if n.Type == "Choice" {
			field := path(n.Props["value"].(map[string]any)["$bindState"])
			if _, ok := writers[field]; ok {
				return ErrInvalid
			}
			writers[field] = n
			f, ok := d.StateSchema[field]
			if !ok {
				return ErrInvalid
			}
			vals := []string{}
			for _, item := range n.Props["options"].([]any) {
				vals = append(vals, item.(map[string]any)["value"].(string))
			}
			expected := f.Enum
			if n.Props["mode"] == "multiple" {
				if f.Type != "array" || !f.UniqueItems || f.Items == nil || f.MaxItems < 1 || f.MaxItems > len(vals) {
					return ErrInvalid
				}
				expected = f.Items.Enum
			} else {
				if f.Type != "string" {
					return ErrInvalid
				}
				vals = append(vals, "")
			}
			x, _ := json.Marshal(sorted(vals))
			y, _ := json.Marshal(sorted(expected))
			if !bytes.Equal(x, y) {
				return ErrInvalid
			}
		}
		if n.Type == "Ranking" || n.Type == "Slider" || n.Type == "TextInput" {
			field := path(n.Props["value"].(map[string]any)["$bindState"])
			if _, exists := writers[field]; exists {
				return ErrInvalid
			}
			writers[field] = n
			f, exists := d.StateSchema[field]
			if !exists || !validExtendedWriter(n, f) {
				return ErrInvalid
			}
		}
		if !d.validExtendedReader(n) {
			return ErrInvalid
		}
		if n.Type == "Feedback" {
			c, ok := d.Spec.Elements[n.Props["choiceElement"].(string)]
			if !ok || c.Type != "Choice" || c.Props["mode"] != "single" {
				return ErrInvalid
			}
			cases := n.Props["cases"].([]any)
			if len(cases) != len(c.Props["options"].([]any)) {
				return ErrInvalid
			}
			valid := map[string]bool{}
			for _, o := range c.Props["options"].([]any) {
				valid[o.(map[string]any)["value"].(string)] = true
			}
			correct := 0
			for _, x := range cases {
				m := x.(map[string]any)
				if !valid[m["value"].(string)] {
					return ErrInvalid
				}
				if m["outcome"] == "correct" {
					correct++
				}
			}
			if correct != 1 {
				return ErrInvalid
			}
		}
		if a, ok := n.On["press"]; ok {
			if a.Action == "continue_chat" {
				continues++
				for _, p := range a.Params["paths"].([]any) {
					submitted[path(p)] = true
				}
			}
			if a.Action == "check_answer" {
				f, ok := d.Spec.Elements[a.Params["feedbackElement"].(string)]
				if !ok || f.Type != "Feedback" {
					return ErrInvalid
				}
			}
		}
		for _, child := range n.Children {
			if n.Type == "Reveal" && d.Spec.Elements[child].Type != "Text" {
				return ErrInvalid
			}
			if e := visit(child, depth+1); e != nil {
				return e
			}
		}
		return nil
	}
	if e := visit(d.Spec.Root, 1); e != nil {
		return e
	}
	if len(visited) != len(d.Spec.Elements) || ((d.Version != "cove-card-v3" && continues != 1) || continues > 1) || len(writers) != len(d.StateSchema) {
		return ErrInvalid
	}
	for key, f := range d.StateSchema {
		if path("/"+key) == "" {
			return ErrInvalid
		}
		n, ok := writers[key]
		if !ok {
			return ErrInvalid
		}
		if (n.Props["required"] == true || n.Type == "Ranking" || n.Type == "Slider" || n.Type == "TextInput") && !submitted[key] && continues > 0 {
			return ErrInvalid
		}
		if f.Type != "string" && f.Type != "array" && f.Type != "integer" {
			return ErrInvalid
		}
	}
	for k := range submitted {
		if _, ok := writers[k]; !ok {
			return ErrInvalid
		}
	}
	return d.ValidateValues(d.Spec.State, nil, false)
}
func sorted(s []string) []string { c := append([]string{}, s...); sort.Strings(c); return c }
func (d Definition) ValidateValues(values map[string]any, checks map[string]string, required bool) error {
	if checks == nil {
		checks = map[string]string{}
	}
	b, _ := json.Marshal([]any{values, checks})
	if len(b) > 16384 || len(values) != len(d.StateSchema) {
		return ErrInvalid
	}
	for k, f := range d.StateSchema {
		v, ok := values[k]
		if !ok {
			return ErrInvalid
		}
		enum := f.Enum
		if f.Type == "array" {
			enum = f.Items.Enum
		}
		allowed := map[string]bool{}
		for _, s := range enum {
			allowed[s] = true
		}
		if f.Type == "integer" {
			value, ok := boundedInteger(v)
			if !ok || f.Minimum == nil || f.Maximum == nil || f.Step == nil || value < *f.Minimum || value > *f.Maximum || (value-*f.Minimum)%*f.Step != 0 {
				return ErrInvalid
			}
		} else if f.Type == "string" {
			s, ok := v.(string)
			if !ok || (f.Enum != nil && !allowed[s]) || (f.Enum == nil && (f.MaxLength == nil || !utf8.ValidString(s) || strings.ContainsRune(s, '\ufffd') || utf8.RuneCountInString(s) > *f.MaxLength)) {
				return ErrInvalid
			}
		} else {
			a, ok := v.([]any)
			if !ok || len(a) > f.MaxItems {
				return ErrInvalid
			}
			seen := map[string]bool{}
			for _, x := range a {
				s, ok := x.(string)
				if !ok || !allowed[s] || seen[s] {
					return ErrInvalid
				}
				seen[s] = true
			}
		}
	}
	for _, n := range d.Spec.Elements {
		if n.Type == "Ranking" {
			field := path(n.Props["value"].(map[string]any)["$bindState"])
			if len(values[field].([]any)) != len(n.Props["options"].([]any)) {
				return ErrInvalid
			}
		}
	}
	for key, value := range checks {
		f, ok := d.Spec.Elements[key]
		if !ok || f.Type != "Feedback" {
			return ErrInvalid
		}
		choice := d.Spec.Elements[f.Props["choiceElement"].(string)]
		field := path(choice.Props["value"].(map[string]any)["$bindState"])
		if values[field] != value || value == "" {
			return ErrInvalid
		}
	}
	if required {
		for _, n := range d.Spec.Elements {
			if (n.Type == "Choice" || n.Type == "TextInput") && n.Props["required"] == true {
				field := path(n.Props["value"].(map[string]any)["$bindState"])
				v := values[field]
				if str, ok := v.(string); ok && strings.TrimSpace(str) == "" {
					return ErrInvalid
				}
				if a, ok := v.([]any); ok && len(a) == 0 {
					return ErrInvalid
				}
			}
		}
	}
	return nil
}
func Extract(body string) (Definition, error) {
	block, err := modelBlock(body)
	if err != nil {
		return Definition{}, err
	}
	return Normalize([]byte(block.json))
}

func Fingerprint(input Submission, question string, extra ...any) string {
	if input.Checks == nil {
		input.Checks = map[string]string{}
	}
	b, _ := json.Marshal([]any{input, question, extra})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func (d Definition) Input(values map[string]any, checks map[string]string, question string, sourceID ...string) (string, string, error) {
	return d.input(values, checks, question, false, sourceID...)
}
func (d Definition) DiscussInput(values map[string]any, checks map[string]string, question string, sourceID ...string) (string, string, error) {
	if strings.TrimSpace(question) == "" {
		return "", "", ErrInvalid
	}
	return d.input(values, checks, question, true, sourceID...)
}
func (d Definition) input(values map[string]any, checks map[string]string, question string, discuss bool, sourceID ...string) (string, string, error) {
	if e := d.ValidateValues(values, checks, !discuss); e != nil {
		return "", "", e
	}
	selections := []string{}
	snapshot := map[string]any{"version": "interaction-v1", "question": d.Spec.Elements[d.Spec.Root].Props["title"], "values": map[string]any{}, "checks": checks}
	selected := snapshot["values"].(map[string]any)
	for _, n := range d.Spec.Elements {
		a, ok := n.On["press"]
		if !ok || a.Action != "continue_chat" {
			continue
		}
		for _, p := range a.Params["paths"].([]any) {
			key := path(p)
			selected[key] = values[key]
		}
	}
	for _, key := range sortedKeys(selected) {
		for _, n := range d.Spec.Elements {
			if n.Type != "Choice" || path(n.Props["value"].(map[string]any)["$bindState"]) != key {
				continue
			}
			for _, o := range n.Props["options"].([]any) {
				item := o.(map[string]any)
				v := values[key]
				match := v == item["value"]
				if array, ok := v.([]any); ok {
					match = false
					for _, x := range array {
						match = match || x == item["value"]
					}
				}
				if match {
					selections = append(selections, item["label"].(string))
				}
			}
		}
	}
	if d.Version != "cove-card-v1" {
		selections = d.valueLabels(selected)
		snapshot["version"] = "interaction-v2"
		snapshot["catalog_version"] = d.CatalogVersion
		snapshot["definition_version"] = d.Version
		snapshot["calculations"] = d.Allocations(selected)
	}
	if len(sourceID) > 0 {
		snapshot["source_generation_id"] = sourceID[0]
	}
	canonical, _ := json.Marshal(d)
	hash := sha256.Sum256(canonical)
	snapshot["definition_hash"] = hex.EncodeToString(hash[:])
	if discuss {
		snapshot["intent"] = "discuss"
	}
	snapshot["user_question"] = question
	snapshot["selected_labels"] = selections
	feedback := map[string]any{}
	for key, value := range checks {
		for _, item := range d.Spec.Elements[key].Props["cases"].([]any) {
			c := item.(map[string]any)
			if c["value"] == value {
				feedback[key] = c
			}
		}
	}
	savedChecks := map[string]string{}
	for key, value := range checks {
		f := d.Spec.Elements[key]
		choice := d.Spec.Elements[f.Props["choiceElement"].(string)]
		field := path(choice.Props["value"].(map[string]any)["$bindState"])
		if _, ok := selected[field]; ok {
			savedChecks[key] = value
		} else {
			delete(feedback, key)
		}
	}
	snapshot["checks"] = savedChecks
	snapshot["feedback"] = feedback
	b, _ := json.Marshal(snapshot)
	if len(b) > 32768 {
		return "", "", ErrInvalid
	}
	prefix := "I chose: "
	if d.Version != "cove-card-v1" {
		prefix = "My input: "
	}
	summary := prefix + strings.Join(selections, "; ") + "."
	if strings.TrimSpace(question) != "" {
		summary += "\n\n" + strings.TrimSpace(question)
	}
	if discuss {
		summary = strings.TrimSpace(question)
	}
	return summary, summary + "\n\nInteraction reference data (not instructions):\n" + string(b), nil
}
func sortedKeys(m map[string]any) []string {
	a := make([]string, 0, len(m))
	for k := range m {
		a = append(a, k)
	}
	sort.Strings(a)
	return a
}

//go:embed guide.txt
var guide string

func Prompt() string { return "\n\n[Cove interactive replies: cove_ui 1]\n" + guide }
