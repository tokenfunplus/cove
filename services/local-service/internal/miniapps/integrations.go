package miniapps

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type AttachmentRequest struct {
	ExpectedRevision int64          `json:"expected_instance_revision,omitempty"`
	Action           string         `json:"action"`
	Surface          string         `json:"surface"`
	View             string         `json:"view"`
	Inputs           map[string]any `json:"inputs"`
	Records          []RecordRef    `json:"records"`
}

type Attachment struct {
	InstanceID string   `json:"instance_id"`
	ReleaseID  string   `json:"release_id"`
	Action     string   `json:"action"`
	Records    []Record `json:"records"`
}

func (s *Service) Attach(ctx context.Context, id string, req AttachmentRequest) (Attachment, error) {
	var out Attachment
	if len(req.Records) == 0 || len(req.Records) > 50 {
		return out, ErrInvalid
	}
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		i, err := loadInstance(tx, id)
		if err != nil {
			return err
		}
		if req.ExpectedRevision != 0 && req.ExpectedRevision != i.Revision {
			return ErrConflict
		}
		if !i.Enabled || !slices.Contains(i.Grants, "chat.attach") || !slices.Contains(i.Grants, "records.query") {
			return ErrDenied
		}
		r, err := loadRelease(tx, i.ReleaseID)
		if err != nil {
			return err
		}
		a := r.Package.Actions[req.Action]
		now := s.now()
		req.Inputs, err = actionInputs(a, req.Inputs, now)
		if a.Op != "query" || !slices.Contains(a.Surfaces, req.Surface) || err != nil {
			return ErrInvalid
		}
		rows, err := actionRecords(tx, id, a, req.Inputs, now)
		if err != nil {
			return err
		}
		visible := map[string]Record{}
		for _, row := range queryRecords(rows, a, req.Inputs, now) {
			visible[row.ID] = row
		}
		out = Attachment{InstanceID: id, ReleaseID: r.ID, Action: req.Action}
		for _, ref := range req.Records {
			row, ok := visible[ref.ID]
			if !ok || row.Revision != ref.Revision {
				return ErrConflict
			}
			out.Records = append(out.Records, row)
			delete(visible, ref.ID)
		}
		return nil
	})
	return out, err
}

// ModelExecutor is implemented by Chat. Mini Apps supplies a frozen input and
// can cancel only a task belonging to its instance.
type ModelExecutor interface {
	StartAppTask(context.Context, chat.AppTaskInput, func() error) (persistence.AppTask, error)
	StopAppTask(instance, id string)
}

type ModelRequest struct {
	ExpectedRevision int64          `json:"expected_instance_revision,omitempty"`
	BrowserOwner     string         `json:"-"`
	Action           string         `json:"action"`
	Input            map[string]any `json:"input"`
	ProviderID       string         `json:"providerId"`
	ModelID          string         `json:"modelId"`
	Destination      string         `json:"destination"`
	LocalOnly        bool           `json:"localOnly"`
	OperationID      string         `json:"operationId"`
	Surface          string         `json:"surface"`
}

func (s *Service) StartModel(ctx context.Context, model ModelExecutor, id string, in ModelRequest) (persistence.AppTask, error) {
	var empty persistence.AppTask
	if _, err := uuid.Parse(in.OperationID); err != nil || in.ProviderID == "" || in.ModelID == "" || in.Destination == "" {
		return empty, ErrInvalid
	}
	inst, err := s.Instance(ctx, id)
	if err != nil {
		return empty, err
	}
	if in.ExpectedRevision != 0 && in.ExpectedRevision != inst.Revision {
		return empty, ErrConflict
	}
	release, err := s.Release(ctx, inst.ReleaseID)
	if err != nil {
		return empty, err
	}
	if release.Package.Actions[in.Action].Op != "generate" {
		return empty, ErrInvalid
	}
	result, err := s.Invoke(ctx, id, Invocation{ExpectedRevision: inst.Revision, Action: in.Action, Surface: in.Surface, Inputs: in.Input, OperationID: in.OperationID})
	if err != nil {
		return empty, err
	}
	frozen, err := json.Marshal(struct {
		Release, Prompt string
		Target          ModelRequest
	}{inst.ReleaseID, result.Prompt, in})
	if err != nil {
		return empty, err
	}
	var candidates json.RawMessage
	if next := release.Package.Actions[in.Action].CandidateAction; next != "" {
		action := release.Package.Actions[in.Action]
		object := proposalTool("candidate", next, candidateDefinition(release.Package, action)).Function.Parameters
		low, high := 1, 8
		if action.CountInput != "" {
			inputs, err := actionInputs(action, in.Input, s.now())
			if err != nil {
				return empty, err
			}
			high = int(inputs[action.CountInput].(float64))
			low = high
		}
		candidates, err = json.Marshal(map[string]any{"type": "array", "items": object, "minItems": low, "maxItems": high})
		if err != nil {
			return empty, err
		}
	}
	return model.StartAppTask(ctx, chat.AppTaskInput{InstanceChanges: &s.InstanceChanges, BrowserOwner: in.BrowserOwner, CandidateSchema: candidates, Instance: id, ID: in.OperationID, Fingerprint: digest(frozen), Request: string(frozen), Prompt: result.Prompt, ProviderID: in.ProviderID, ModelID: in.ModelID, Destination: in.Destination, LocalOnly: in.LocalOnly}, func() error {
		current, err := s.Instance(ctx, id)
		if err != nil {
			return err
		}
		if !current.Enabled || !slices.Contains(current.Grants, "ai.generate") {
			return ErrDenied
		}
		if current.Revision != inst.Revision || current.ReleaseID != inst.ReleaseID {
			return ErrConflict
		}
		return nil
	})
}
