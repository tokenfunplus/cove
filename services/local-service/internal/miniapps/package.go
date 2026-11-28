// Package miniapps implements the versioned, data-only Cove Mini App contract.
package miniapps

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalid        = errors.New("invalid mini app request")
	ErrDenied         = errors.New("mini app capability denied")
	ErrConflict       = errors.New("mini app state changed")
	ErrNotFound       = errors.New("mini app not found")
	ErrPreviewExpired = errors.New("mini app change preview expired")
	slug              = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)
	key               = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,47}$`)
	actionID          = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.]{0,79}$`)
	semver            = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)
	dayOffset         = regexp.MustCompile(`^\$today([+-][0-9]{1,4})?$`)
)

const MaxPackageBytes = 1 << 20
const maxTextBytes = 60000
const maxRecords = 2000
const maxRecordBytes = 96 << 10

var capabilities = []string{"blobs.import", "records.query", "records.commit", "ai.generate", "mac.files.pick", "mac.selection.receive", "chat.attach", "speech.speak", "documents.search"}
var surfaces = []string{"page", "chat", "panel"}

type Package struct {
	SpeechLanguage string                      `json:"speech_language,omitempty"`
	Assets         map[string]ImageAsset       `json:"assets,omitempty"`
	MinHostVersion string                      `json:"min_host_version,omitempty"`
	Format         int                         `json:"format"`
	Publisher      string                      `json:"publisher"`
	App            string                      `json:"app"`
	Name           string                      `json:"name"`
	Description    string                      `json:"description"`
	Version        string                      `json:"version"`
	SchemaVersion  int                         `json:"schema_version"`
	Capabilities   []string                    `json:"capabilities"`
	Collections    map[string]Collection       `json:"collections"`
	Pages          []Page                      `json:"pages"`
	Actions        map[string]Action           `json:"actions"`
	Seed           map[string][]map[string]any `json:"seed,omitempty"`
	Migrations     []Migration                 `json:"migrations,omitempty"`
}
type RecordLink struct {
	Query string `json:"query"`
	Label string `json:"label"`
}
type Collection struct {
	Links  map[string]RecordLink `json:"links,omitempty"`
	Fields map[string]string     `json:"fields"`
}
type Practice struct {
	Query    string   `json:"query"`
	Front    string   `json:"front"`
	Back     string   `json:"back"`
	Outcomes []string `json:"outcomes"`
}
type Page struct {
	Image    string    `json:"image,omitempty"`
	Practice *Practice `json:"practice,omitempty"`
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Actions  []string  `json:"actions"`
}
type Predicate struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}
type SelectionInputs struct {
	Collection string            `json:"collection"`
	Fields     map[string]string `json:"fields"`
}
type Action struct {
	OutputSchema      *ActionOutput     `json:"output_schema,omitempty"`
	Defaults          map[string]any    `json:"defaults,omitempty"`
	LimitInput        string            `json:"limit_input,omitempty"`
	CountInput        string            `json:"count_input,omitempty"`
	Selection         *SelectionInputs  `json:"selection_inputs,omitempty"`
	CandidateBindings map[string]string `json:"candidate_bindings,omitempty"`
	Title             string            `json:"title"`
	Op                string            `json:"op"`
	Collection        string            `json:"collection,omitempty"`
	Inputs            map[string]string `json:"inputs"`
	Surfaces          []string          `json:"surfaces"`
	Where             []Predicate       `json:"where,omitempty"`
	Values            map[string]any    `json:"values,omitempty"`
	RevealField       string            `json:"reveal_field,omitempty"`
	OrderBy           string            `json:"order_by,omitempty"`
	Limit             int               `json:"limit,omitempty"`
	Prompt            string            `json:"prompt,omitempty"`
	TextInput         string            `json:"text_input,omitempty"`
	CandidateAction   string            `json:"candidate_action,omitempty"`
}
type Migration struct {
	From     int                       `json:"from"`
	To       int                       `json:"to"`
	Defaults map[string]map[string]any `json:"defaults"`
}

func invalid(reason string) error { return fmt.Errorf("%w: %s", ErrInvalid, reason) }
func short(s string, n int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= n && !strings.ContainsRune(s, 0)
}
func validType(t string) bool { return t == "text" || t == "date" || t == "bool" || t == "number" }
func validFields(fields map[string]string) bool {
	if len(fields) > 40 {
		return false
	}
	for k, t := range fields {
		if !key.MatchString(k) || !validType(t) {
			return false
		}
	}
	return true
}
func matches(v any, t string) bool {
	switch t {
	case "text":
		s, ok := v.(string)
		return ok && len(s) <= maxTextBytes
	case "date":
		s, ok := v.(string)
		if !ok {
			return false
		}
		_, err := time.Parse(time.DateOnly, s)
		return err == nil
	case "bool":
		_, ok := v.(bool)
		return ok
	case "number":
		n, ok := v.(float64)
		return ok && !math.IsNaN(n) && !math.IsInf(n, 0)
	}
	return false
}
func expression(v any, t string, inputs map[string]string) bool {
	if s, ok := v.(string); ok && strings.HasPrefix(s, "$") {
		if dayOffset.MatchString(s) {
			return t == "date"
		}
		k, ref := strings.CutPrefix(s, "$input.")
		return ref && t != "" && inputs[k] == t
	}
	return matches(v, t)
}
func resolve(v any, inputs map[string]any, now time.Time) any {
	s, ok := v.(string)
	if !ok {
		return v
	}
	if k, ok := strings.CutPrefix(s, "$input."); ok {
		return inputs[k]
	}
	if dayOffset.MatchString(s) {
		days, _ := strconv.Atoi(strings.TrimPrefix(s, "$today"))
		// Dates are civil values. Local midnight can be skipped by a time zone
		// transition, so apply offsets to the local calendar date in UTC.
		year, month, day := now.Date()
		return time.Date(year, month, day+days, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
	}
	return v
}
func subset(values, allowed []string) bool {
	seen := map[string]bool{}
	for _, v := range values {
		if seen[v] || !slices.Contains(allowed, v) {
			return false
		}
		seen[v] = true
	}
	return true
}
func unique(values []string) bool {
	seen := map[string]bool{}
	for _, v := range values {
		if seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
func capability(op string) string {
	switch op {
	case "query":
		return "records.query"
	case "create", "update", "delete":
		return "records.commit"
	case "generate":
		return "ai.generate"
	}
	return ""
}

// decodeStrict rejects ambiguous duplicate properties, unknown struct fields and deeply nested input.
func decodeStrict(raw []byte, target any) error {
	if len(raw) == 0 || len(raw) > MaxPackageBytes || !utf8.Valid(raw) {
		return invalid("package size or encoding")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := scanTypedJSON(dec, 0, reflect.TypeOf(target).Elem()); err != nil {
		return invalid("malformed, duplicate or deeply nested JSON")
	}
	if _, err := dec.Token(); err != io.EOF {
		return invalid("unexpected trailing data")
	}
	dec = json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return invalid("unexpected package fields or types")
	}
	return nil
}

// Backups have their own size and shape validation and share the token walker.
func scanJSON(dec *json.Decoder, depth int) error { return scanTypedJSON(dec, depth, nil) }

// encoding/json accepts struct property names case-insensitively. The package
// contract and the browser use exact keys, so check them during the duplicate scan.
func objectField(object reflect.Type, name string) (reflect.Type, bool) {
	if object == nil || object.Kind() == reflect.Interface {
		return nil, true
	}
	if object.Kind() == reflect.Map {
		return object.Elem(), true
	}
	if object.Kind() != reflect.Struct {
		return nil, false
	}
	for f := range object.NumField() {
		field := object.Field(f)
		tag, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if tag == name {
			return field.Type, true
		}
	}
	return nil, false
}
func scanTypedJSON(dec *json.Decoder, depth int, typ reflect.Type) error {
	if typ != nil && typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	if depth > 24 {
		return ErrInvalid
	}
	v, err := dec.Token()
	if err != nil {
		return err
	}
	switch v {
	case nil:
		if typ != nil {
			return ErrInvalid
		}
		return nil
	case json.Delim('{'):
		seen := map[string]bool{}
		for dec.More() {
			k, err := dec.Token()
			if err != nil {
				return err
			}
			s, ok := k.(string)
			if !ok || seen[s] {
				return ErrInvalid
			}
			seen[s] = true
			child, known := objectField(typ, s)
			if !known {
				return ErrInvalid
			}
			if err := scanTypedJSON(dec, depth+1, child); err != nil {
				return err
			}
		}
	case json.Delim('['):
		var child reflect.Type
		if typ != nil && typ.Kind() == reflect.Slice {
			child = typ.Elem()
		}
		for dec.More() {
			if err := scanTypedJSON(dec, depth+1, child); err != nil {
				return err
			}
		}
	default:
		return nil
	}
	_, err = dec.Token()
	return err
}

func Validate(raw []byte) (Package, error) {
	var p Package
	if err := decodeStrict(raw, &p); err != nil {
		return p, err
	}
	if p.Format != 1 || !slug.MatchString(p.Publisher) || !slug.MatchString(p.App) || !short(p.Name, 100) || !short(p.Description, 1000) || !semver.MatchString(p.Version) || p.SchemaVersion < 1 || p.SchemaVersion > 1000 {
		return p, invalid("identity, name, version or runtime format")
	}
	if p.Capabilities == nil || !subset(p.Capabilities, capabilities) {
		return p, invalid("capabilities")
	}
	if len(p.Collections) < 1 || len(p.Collections) > 16 || len(p.Actions) < 1 || len(p.Actions) > 64 || len(p.Pages) < 1 || len(p.Pages) > 16 {
		return p, invalid("collection, page or action count")
	}
	for k, c := range p.Collections {
		if !key.MatchString(k) || len(c.Fields) == 0 || !validFields(c.Fields) {
			return p, invalid("collection fields")
		}
		for field, link := range c.Links {
			q := p.Actions[link.Query]
			if c.Fields[field] != "text" || c.Fields[link.Label] != "text" || q.Op != "query" || len(q.Inputs) != 1 || q.Inputs["id"] != "text" || len(q.Where) != 1 || q.Where[0].Field != "$id" || q.Where[0].Op != "eq" || q.Where[0].Value != "$input.id" {
				return p, invalid("record link lookup")
			}
		}
	}
	if err := validateAssets(p); err != nil {
		return p, err
	}
	if err := validateHostContract(p); err != nil {
		return p, err
	}
	for k, a := range p.Actions {
		if !actionID.MatchString(k) || !short(a.Title, 100) || a.Inputs == nil || !validFields(a.Inputs) || len(a.Surfaces) == 0 || !subset(a.Surfaces, surfaces) || !slices.Contains(p.Capabilities, capability(a.Op)) {
			return p, invalid("action " + k)
		}
		if err := validateAction(p, a); err != nil {
			return p, fmt.Errorf("%s: %w", k, err)
		}
	}
	seen := map[string]bool{}
	for _, page := range p.Pages {
		if !slug.MatchString(page.ID) || seen[page.ID] || !short(page.Title, 100) || len(page.Actions) == 0 || !unique(page.Actions) {
			return p, invalid("page definition")
		}
		if err := validatePractice(p, page); err != nil {
			return p, err
		}
		seen[page.ID] = true
		for _, id := range page.Actions {
			if !slices.Contains(p.Actions[id].Surfaces, "page") {
				return p, invalid("page action reference")
			}
		}
	}
	total := 0
	for col, rows := range p.Seed {
		fields := p.Collections[col].Fields
		if fields == nil {
			return p, invalid("seed collection")
		}
		total += len(rows)
		for _, row := range rows {
			if !validValues(row, fields, nil, true) {
				return p, invalid("seed fields")
			}
			// Count the stored JSON, including escaping and resolved date lengths.
			resolved := make(map[string]any, len(row))
			for k, v := range row {
				resolved[k] = resolve(v, nil, time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC))
			}
			encoded, err := json.Marshal(resolved)
			if err != nil || len(encoded) > maxRecordBytes {
				return p, invalid("seed record size limit")
			}
		}
	}
	if total > 200 {
		return p, invalid("seed record limit")
	}
	seenVersions := map[int]bool{}
	for _, m := range p.Migrations {
		if seenVersions[m.From] || m.From < 1 || m.To != m.From+1 || m.To > p.SchemaVersion {
			return p, invalid("migration sequence")
		}
		seenVersions[m.From] = true
		for k, defs := range m.Defaults {
			fields := p.Collections[k].Fields
			if fields == nil || !validValues(defs, fields, nil, false) {
				return p, invalid("migration defaults")
			}
		}
	}
	return p, nil
}
func validValues(values map[string]any, fields, inputs map[string]string, all bool) bool {
	if all && len(values) != len(fields) {
		return false
	}
	for k, v := range values {
		if !expression(v, fields[k], inputs) {
			return false
		}
	}
	return true
}
func validateAction(p Package, a Action) error {
	if err := validateActionOptions(p, a); err != nil {
		return err
	}
	if a.RevealField != "" && (a.Op != "query" || p.Collections[a.Collection].Fields[a.RevealField] == "") {
		return invalid("query disclosure field")
	}
	if a.Op == "generate" {
		if a.Collection != "" || len(a.Where) > 0 || len(a.Values) > 0 || a.Limit != 0 || a.OrderBy != "" || !short(a.Prompt, 8000) || a.Inputs[a.TextInput] != "text" {
			return invalid("generate definition")
		}
		if a.CandidateAction != "" {
			target, ok := p.Actions[a.CandidateAction]
			if !ok || target.Op != "create" || !subset(a.Surfaces, target.Surfaces) {
				return invalid("candidate action")
			}
		}
		return nil
	}
	fields := p.Collections[a.Collection].Fields
	if fields == nil || a.Prompt != "" || a.TextInput != "" || a.CandidateAction != "" {
		return invalid("record action collection or properties")
	}
	switch a.Op {
	case "query", "delete":
		if a.Op == "delete" && (a.Limit != 0 || a.OrderBy != "" || len(a.Inputs) != 0) {
			return invalid("delete definition")
		}
		if len(a.Values) > 0 || len(a.Where) > 12 || a.Limit < 0 || a.Limit > 200 || (a.OrderBy != "" && fields[a.OrderBy] == "") {
			return invalid("query definition")
		}
		for _, w := range a.Where {
			t := fields[w.Field]
			if w.Field == "$id" {
				t = "text"
			}
			if !expression(w.Value, t, a.Inputs) || !slices.Contains([]string{"eq", "ne", "lt", "lte", "gt", "gte"}, w.Op) || (t == "bool" && w.Op != "eq" && w.Op != "ne") {
				return invalid("query predicate")
			}
		}
	case "create", "update":
		if len(a.Where) > 0 || a.Limit != 0 || a.OrderBy != "" || len(a.Values) == 0 {
			return invalid("record assignments")
		}
		if a.Op == "create" && !validValues(a.Values, fields, a.Inputs, true) {
			return invalid("create assignments")
		}
		if a.Op == "update" {
			for k, v := range a.Values {
				if ruleTypes(v, fields, a.Inputs, 0)&fieldType(fields[k]) == 0 {
					return invalid("update rule for " + k)
				}
			}
		}
	default:
		return invalid("operation")
	}
	return nil
}
