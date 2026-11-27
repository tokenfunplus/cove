package miniapps

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type ProposalRequest struct {
	Actions     []string `json:"actions"`
	Question    string   `json:"question"`
	Surface     string   `json:"surface"`
	ProviderID  string   `json:"providerId"`
	ModelID     string   `json:"modelId"`
	Destination string   `json:"destination"`
	OperationID string   `json:"operationId"`
	LocalOnly   bool     `json:"localOnly"`
}

type proposedAction struct {
	Action string         `json:"action"`
	Inputs map[string]any `json:"inputs"`
}

func (s *Service) StartProposal(ctx context.Context, model ModelExecutor, instanceID string, req ProposalRequest) (persistence.AppTask, error) {
	var empty persistence.AppTask
	if _, err := uuid.Parse(req.OperationID); err != nil || !short(req.Question, 8000) || req.Surface != "chat" && req.Surface != "panel" || len(req.Actions) == 0 || len(req.Actions) > 16 || !unique(req.Actions) || !short(req.ModelID, 512) || !short(req.Destination, 2048) || !short(req.ProviderID, 256) {
		return empty, ErrInvalid
	}
	instance, err := s.Instance(ctx, instanceID)
	if err != nil {
		return empty, err
	}
	release, err := s.Release(ctx, instance.ReleaseID)
	if err != nil {
		return empty, err
	}
	if !instance.Enabled {
		return empty, ErrDenied
	}
	selected, err := appActionDefinitions(instance, release.Package, req.Actions, req.Surface)
	if err != nil {
		return empty, err
	}
	tools := selected.Tools
	schemas, err := json.Marshal(tools)
	if err != nil {
		return empty, err
	}
	prompt := "Help the user choose one app action. Propose exactly one function with its typed inputs. If function calling is unavailable, return only a JSON object with action set to its function name and inputs set to its arguments. A person will review it before running it.\nSelected actions:\n" + string(schemas) + "\nUser request:\n" + req.Question
	frozen, err := json.Marshal(struct {
		Release          string
		ProposalRevision int64
		Target           ProposalRequest
	}{instance.ReleaseID, instance.Revision, req})
	if err != nil {
		return empty, err
	}
	check := func() error {
		current, err := s.Instance(ctx, instanceID)
		if err != nil {
			return err
		}
		if !current.Enabled || current.Revision != instance.Revision || current.ReleaseID != instance.ReleaseID {
			return ErrConflict
		}
		return nil
	}
	return model.StartAppTask(ctx, chat.AppTaskInput{InstanceChanges: &s.InstanceChanges, Instance: instanceID, ID: req.OperationID, Fingerprint: digest(frozen), Request: string(frozen), Prompt: prompt, ProviderID: req.ProviderID, ModelID: req.ModelID, Destination: req.Destination, LocalOnly: req.LocalOnly, ProposalTools: tools, ValidateProposal: selected.Normalize}, check)
}

func proposalTool(alias, id string, a Action) provider.Tool {
	typeNames := map[string]string{"text": "string", "number": "number", "bool": "boolean", "date": "string"}
	props := map[string]map[string]string{}
	required := []string{}
	for key, t := range a.Inputs {
		prop := map[string]string{"type": typeNames[t]}
		if t == "date" {
			prop["format"] = "date"
		}
		props[key] = prop
		if _, optional := a.Defaults[key]; !optional {
			required = append(required, key)
		}
	}
	sort.Strings(required)
	params, _ := json.Marshal(map[string]any{"type": "object", "additionalProperties": false, "properties": props, "required": required})
	return provider.Tool{Type: "function", Function: provider.ToolFunction{Name: alias, Description: fmt.Sprintf("%s (%s): %s", id, a.Op, a.Title), Parameters: params}}
}

func normalizeProposal(body string, aliases map[string]string, pkg Package) (string, error) {
	body = strings.TrimSpace(body)
	if len(body) > 60_000 {
		return "", ErrInvalid
	}
	// Accept a single JSON object with a short presentation wrapper. Reject
	// arrays, multiple candidates, and nested or unmatched surrounding braces.
	start, end := strings.IndexByte(body, '{'), strings.LastIndexByte(body, '}')
	if start < 0 || end < start || start > 256 || len(body)-end-1 > 256 || strings.ContainsAny(body[:start]+body[end+1:], "[]{}") {
		return "", ErrInvalid
	}
	if json.Valid([]byte(strings.TrimSpace(body[:start]))) || json.Valid([]byte(strings.TrimSpace(body[end+1:]))) {
		return "", ErrInvalid
	}
	body = body[start : end+1]
	var candidate proposedAction
	if err := decodeStrict([]byte(body), &candidate); err != nil {
		return "", err
	}
	id, known := aliases[candidate.Action]
	if _, err := actionInputs(pkg.Actions[id], candidate.Inputs, time.Now()); !known || candidate.Inputs == nil || err != nil {
		return "", invalid("model proposed an unavailable action or invalid inputs")
	}
	candidate.Action = id
	out, err := json.Marshal(candidate)
	return string(out), err
}

// ChatActions resolves the exact release and grants selected for one ordinary Chat turn.
func (s *Service) ChatActions(ctx context.Context, scope persistence.MiniAppScope) (chat.AppActions, error) {
	var out chat.AppActions
	if len(scope.Actions) == 0 || len(scope.Actions) > 16 || !unique(scope.Actions) {
		return out, ErrInvalid
	}
	instance, err := s.Instance(ctx, scope.Instance)
	if err != nil {
		return out, err
	}
	if !instance.Enabled || instance.ReleaseID != scope.Release || instance.Revision != scope.Revision {
		return out, ErrConflict
	}
	release, err := s.Release(ctx, scope.Release)
	if err != nil {
		return out, err
	}
	return appActionDefinitions(instance, release.Package, scope.Actions, "chat")
}

func appActionDefinitions(instance Instance, pkg Package, ids []string, surface string) (chat.AppActions, error) {
	var out chat.AppActions
	aliases := map[string]string{}
	for index, id := range ids {
		act, ok := pkg.Actions[id]
		if !ok || !slices.Contains(act.Surfaces, surface) || !slices.Contains(instance.Grants, capability(act.Op)) {
			return chat.AppActions{}, ErrDenied
		}
		alias := fmt.Sprintf("choice_%d", index+1)
		aliases[alias] = id
		out.Tools = append(out.Tools, proposalTool(alias, id, act))
	}
	out.Normalize = func(body string) (string, error) { return normalizeProposal(body, aliases, pkg) }
	return out, nil
}

func (s *Service) AppName(ctx context.Context, id string) string {
	instance, err := s.Instance(ctx, id)
	if err != nil {
		return ""
	}
	return instance.Name
}
