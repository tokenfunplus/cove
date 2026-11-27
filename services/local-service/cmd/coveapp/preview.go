package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"

	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type workspace struct {
	service *miniapps.Service
	id      string
}

// Each command owns its in-memory database. The authoring runtime has no connection
// to the user's local service, model transport or Launcher.
func inPreview(source []byte, run func(workspace, miniapps.Package) error) error {
	pkg, err := miniapps.Validate(source)
	if err != nil {
		return err
	}
	store, err := persistence.OpenSQLite(":memory:")
	if err != nil {
		return err
	}
	defer store.Close()
	ctx := context.Background()
	service := miniapps.New(store)
	// The bundled examples use the reserved publisher. This origin exists only in
	// this ephemeral database; the CLI cannot make a trusted release on the Mac.
	release, err := service.Install(ctx, source, "builtin")
	if err != nil {
		return err
	}
	instance, err := service.Create(ctx, miniapps.CreateRequest{
		ReleaseID: release.ID, Name: "Author preview", Grants: pkg.Capabilities,
	})
	if err != nil {
		return err
	}
	return run(workspace{service: service, id: instance.ID}, pkg)
}

// Commands exercise the complete query in their isolated, single-writer instance.
func (w workspace) invoke(call miniapps.Invocation) (miniapps.Result, error) {
	ctx := context.Background()
	result, err := w.service.Invoke(ctx, w.id, call)
	for err == nil && result.NextCursor != "" {
		call.Cursor = result.NextCursor
		var page miniapps.Result
		page, err = w.service.Invoke(ctx, w.id, call)
		result.Records = append(result.Records, page.Records...)
		result.NextCursor = page.NextCursor
	}
	return result, err
}

func preview(source []byte, out io.Writer) error {
	return inPreview(source, func(w workspace, pkg miniapps.Package) error {
		fmt.Fprintf(out, "%s %s\n%s\n", pkg.Name, pkg.Version, pkg.Description)
		for _, page := range pkg.Pages {
			fmt.Fprintf(out, "\n[%s] %s\n", page.ID, page.Title)
			for _, id := range page.Actions {
				action := pkg.Actions[id]
				fmt.Fprintf(out, "  %s (%s)  %s\n", action.Title, action.Op, id)
				if action.Op != "query" || len(action.Inputs) != 0 {
					continue
				}
				result, err := w.invoke(miniapps.Invocation{
					Action: id, Surface: "page", OperationID: "preview", Inputs: map[string]any{},
				})
				if err != nil {
					return err
				}
				for _, record := range result.Records {
					if err := json.NewEncoder(out).Encode(record.Fields); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
}

type scenario struct {
	Steps []scenarioStep `json:"steps"`
}

type scenarioStep struct {
	Action       string         `json:"action"`
	Inputs       map[string]any `json:"inputs"`
	Surface      string         `json:"surface"`
	Select       []int          `json:"select"`
	Count        *int           `json:"count"`
	ExpectFields map[string]any `json:"expect_fields"`
}

func runScenario(source []byte, path string, out io.Writer) error {
	b, err := readBounded(path)
	if err != nil {
		return err
	}
	var spec scenario
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("expected one scenario object")
	}
	if len(spec.Steps) < 1 || len(spec.Steps) > 256 {
		return errors.New("provide 1 to 256 scenario steps")
	}
	return inPreview(source, func(w workspace, pkg miniapps.Package) error {
		var previous []miniapps.Record
		for index, step := range spec.Steps {
			result, err := w.step(pkg, step, previous, index+1)
			if err != nil {
				return fmt.Errorf("step %d (%s): %w", index+1, step.Action, err)
			}
			previous = result.Records
			fmt.Fprintf(out, "ok %d %s\n", index+1, step.Action)
		}
		return nil
	})
}

func (w workspace) step(pkg miniapps.Package, step scenarioStep, previous []miniapps.Record, number int) (miniapps.Result, error) {
	var empty miniapps.Result
	action, ok := pkg.Actions[step.Action]
	if !ok {
		return empty, errors.New("unknown action")
	}
	if step.Surface == "" {
		step.Surface = action.Surfaces[0]
	}
	call := miniapps.Invocation{
		Action: step.Action, Inputs: step.Inputs, Surface: step.Surface, OperationID: fmt.Sprintf("scenario-%d", number),
	}
	if call.Inputs == nil {
		call.Inputs = map[string]any{}
	}
	for _, index := range step.Select {
		if index < 0 || index >= len(previous) {
			return empty, errors.New("selection is outside the previous result")
		}
		row := previous[index]
		call.Records = append(call.Records, miniapps.RecordRef{ID: row.ID, Revision: row.Revision})
	}
	result, err := w.invoke(call)
	if err != nil {
		return empty, err
	}
	if action.Op == "create" || action.Op == "update" {
		if result.Confirmation == "" {
			return empty, errors.New("write returned no preview")
		}
		call.Confirm = result.Confirmation
		result, err = w.invoke(call)
		if err != nil {
			return empty, err
		}
	}
	if action.Op == "generate" && result.Prompt == "" {
		return empty, errors.New("missing model task input")
	}
	if step.Count != nil && len(result.Records) != *step.Count {
		return empty, fmt.Errorf("expected %d records, got %d", *step.Count, len(result.Records))
	}
	if len(step.ExpectFields) > 0 && !slices.ContainsFunc(result.Records, func(record miniapps.Record) bool {
		for key, expected := range step.ExpectFields {
			value, exists := record.Fields[key]
			if !exists || !jsonScalarEqual(value, expected) {
				return false
			}
		}
		return true
	}) {
		return empty, errors.New("no record matched all expected fields")
	}
	return result, nil
}

func jsonScalarEqual(a, b any) bool {
	switch value := a.(type) {
	case bool, float64, string:
		return value == b
	}
	return false
}
