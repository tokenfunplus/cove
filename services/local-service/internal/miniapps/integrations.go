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
	Action  string         `json:"action"`
	Surface string         `json:"surface"`
	View    string         `json:"view"`
	Inputs  map[string]any `json:"inputs"`
	Records []RecordRef    `json:"records"`
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
		if !i.Enabled || !slices.Contains(i.Grants, "chat.attach") || !slices.Contains(i.Grants, "records.query") {
			return ErrDenied
		}
		r, err := loadRelease(tx, i.ReleaseID)
		if err != nil {
			return err
		}
		a := r.Package.Actions[req.Action]
		if a.Op != "query" || !slices.Contains(a.Surfaces, req.Surface) || !inputOK(req.Inputs, a.Inputs) {
			return ErrInvalid
		}
		rows, err := loadRecords(tx, id, a.Collection)
		if err != nil {
			return err
		}
		visible := map[string]Record{}
		for _, row := range queryRecords(rows, a, req.Inputs, s.now()) {
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
	BrowserOwner string         `json:"-"`
	Action       string         `json:"action"`
	Input        map[string]any `json:"input"`
	ProviderID   string         `json:"providerId"`
	ModelID      string         `json:"modelId"`
	Destination  string         `json:"destination"`
	LocalOnly    bool           `json:"localOnly"`
	OperationID  string         `json:"operationId"`
	Surface      string         `json:"surface"`
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
	release, err := s.Release(ctx, inst.ReleaseID)
	if err != nil {
		return empty, err
	}
	if release.Package.Actions[in.Action].Op != "generate" {
		return empty, ErrInvalid
	}
	result, err := s.Invoke(ctx, id, Invocation{Action: in.Action, Surface: in.Surface, Inputs: in.Input, OperationID: in.OperationID})
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
		object := proposalTool("candidate", next, release.Package.Actions[next]).Function.Parameters
		candidates, err = json.Marshal(map[string]any{"type": "array", "items": object, "minItems": 1, "maxItems": 8})
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
