package miniapps

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"

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
	aliases := map[string]string{}
	var tools []provider.Tool
	for index, id := range req.Actions {
		action, exists := release.Package.Actions[id]
		if !exists || !slices.Contains(action.Surfaces, req.Surface) || !slices.Contains(instance.Grants, capability(action.Op)) {
			return empty, ErrDenied
		}
		name := fmt.Sprintf("choice_%d", index+1)
		aliases[name] = id
		tools = append(tools, proposalTool(name, id, action))
	}
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
	return model.StartAppTask(ctx, chat.AppTaskInput{InstanceChanges: &s.InstanceChanges, Instance: instanceID, ID: req.OperationID, Fingerprint: digest(frozen), Request: string(frozen), Prompt: prompt, ProviderID: req.ProviderID, ModelID: req.ModelID, Destination: req.Destination, LocalOnly: req.LocalOnly, ProposalTools: tools, ValidateProposal: func(body string) (string, error) {
		return normalizeProposal(body, aliases, release.Package)
	}}, check)
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
		required = append(required, key)
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
	var candidate proposedAction
	if err := decodeStrict([]byte(body), &candidate); err != nil {
		return "", err
	}
	id, known := aliases[candidate.Action]
	if !known || candidate.Inputs == nil || !inputOK(candidate.Inputs, pkg.Actions[id].Inputs) {
		return "", invalid("model proposed an unavailable action or invalid inputs")
	}
	candidate.Action = id
	out, err := json.Marshal(candidate)
	return string(out), err
}
