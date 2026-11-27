package miniapps

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type CandidateCheckRequest struct {
	ExpectedRevision int64            `json:"expected_instance_revision"`
	Action           string           `json:"action"`
	Surface          string           `json:"surface"`
	Items            []map[string]any `json:"items"`
}

// CandidateDuplicates compares user-authored fields in the candidate's destination
// collection, including archived records. It returns positions, never record data.
func (s *Service) CandidateDuplicates(ctx context.Context, id string, req CandidateCheckRequest) ([]int, error) {
	duplicates := []int{}
	if len(req.Items) > 100 {
		return nil, ErrInvalid
	}
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		instance, err := loadInstance(tx, id)
		if err != nil {
			return err
		}
		if !instance.Enabled || !slices.Contains(instance.Grants, "records.query") {
			return ErrDenied
		}
		if instance.Revision != req.ExpectedRevision {
			return ErrConflict
		}
		release, err := loadRelease(tx, instance.ReleaseID)
		if err != nil {
			return err
		}
		generator, ok := release.Package.Actions[req.Action]
		if !ok || generator.Op != "generate" || !slices.Contains(generator.Surfaces, req.Surface) || generator.CandidateAction == "" {
			return ErrInvalid
		}
		target := release.Package.Actions[generator.CandidateAction]
		fields := map[string]string{}
		for field, expression := range target.Values {
			value, ok := expression.(string)
			if !ok {
				continue
			}
			input, ok := strings.CutPrefix(value, "$input.")
			if !ok {
				continue
			}
			if _, bound := generator.CandidateBindings[input]; !bound {
				fields[field] = input
			}
		}
		rows, err := loadRecords(tx, id, target.Collection)
		if err != nil {
			return err
		}
		names := make([]string, 0, len(fields))
		for field := range fields {
			names = append(names, field)
		}
		sort.Strings(names)
		signature := func(values map[string]any, inputs bool) string {
			content := make([]any, 0, len(names))
			for _, field := range names {
				key := field
				if inputs {
					key = fields[field]
				}
				value := values[key]
				if text, ok := value.(string); ok {
					value = strings.Join(strings.Fields(text), " ")
				}
				content = append(content, value)
			}
			raw, _ := json.Marshal(content)
			return string(raw)
		}
		seen := map[string]bool{}
		for _, row := range rows {
			seen[signature(row.Fields, false)] = true
		}
		for index, raw := range req.Items {
			item, err := actionInputs(target, raw, s.now())
			if err != nil {
				return err
			}
			key := signature(item, true)
			if len(fields) > 0 && seen[key] {
				duplicates = append(duplicates, index)
			}
			seen[key] = true
		}
		return nil
	})
	return duplicates, err
}
