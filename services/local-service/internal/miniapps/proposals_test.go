package miniapps

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type captureProposal struct{ in chat.AppTaskInput }

func (c *captureProposal) StartAppTask(_ context.Context, in chat.AppTaskInput, authorize func() error) (persistence.AppTask, error) {
	if err := authorize(); err != nil {
		return persistence.AppTask{}, err
	}
	c.in = in
	return persistence.AppTask{ID: in.ID, State: "running"}, nil
}
func (c *captureProposal) StopAppTask(string, string) {}

func TestModelProposalOnlySeesSelectedSchemasAndCannotWrite(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	_, instance := setup(t, s)
	req := ProposalRequest{Actions: []string{"inbox.add"}, Question: "Save an essay", Surface: "chat", ProviderID: "remote", ModelID: "model", OperationID: uuid.NewString(), Destination: "https://provider.example"}
	m := &captureProposal{}
	if _, err := s.StartProposal(t.Context(), m, instance.ID, req); err != nil {
		t.Fatal(err)
	}
	if len(m.in.ProposalTools) != 1 || !strings.Contains(m.in.Prompt, "inbox.add") || !strings.Contains(m.in.Prompt, req.Question) || strings.Contains(m.in.Prompt, "inbox.queue") || strings.Contains(m.in.Prompt, "An essay to revisit") {
		t.Fatal("proposal sent unselected data")
	}
	for _, bad := range []string{
		`{"action":"choice_2","inputs":{}}`,
		`{"action":"choice_1","inputs":{"title":15,"note":"text"}}`,
		`{"action":"choice_1","inputs":{"title":"q","note":"text"},"confirm":true}`,
		`{"action":"choice_1","inputs":{"title":"q","note":"text","note":"second"}}`,
	} {
		if _, err := m.in.ValidateProposal(bad); err == nil {
			t.Fatal("accepted invalid proposal", bad)
		}
	}
	result, err := m.in.ValidateProposal(`{"action":"choice_1","inputs":{"title":"q","note":"abc"}}`)
	if err != nil || !strings.Contains(result, `"action":"inbox.add"`) {
		t.Fatal(result, err)
	}
	if rows := call(t, s, instance.ID, read("inbox.all")).Records; len(rows) != 1 {
		t.Fatal("proposal mutated records")
	}
	if err := db.BeginAppTask(t.Context(), instance.ID, req.OperationID, "fp", m.in.Request); err != nil {
		t.Fatal(err)
	}
	if _, err := db.AppProposalTask(t.Context(), instance.ID, req.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Configure(t.Context(), instance.ID, ConfigRequest{Revision: instance.Revision, Enabled: true, Grants: []string{"records.query"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartProposal(t.Context(), m, instance.ID, req); !errors.Is(err, ErrDenied) {
		t.Fatal("allowed revoked action", err)
	}
	if _, err := db.AppProposalTask(t.Context(), instance.ID, req.OperationID); err == nil {
		t.Fatal("exposed old proposal after grant change")
	}
	req.Actions = []string{"inbox.queue"}
	req.Surface = "page"
	if _, err := s.StartProposal(t.Context(), m, instance.ID, req); !errors.Is(err, ErrInvalid) {
		t.Fatal("allowed different surface", err)
	}
}

func TestNativeProposalSchemaUsesTypedFields(t *testing.T) {
	tool := proposalTool("choice_1", "capture", Action{Title: "Capture", Op: "create", Inputs: map[string]string{"seen": "bool", "when": "date", "size": "number"}})
	var schema struct {
		AdditionalProperties bool
		Properties           map[string]map[string]string
		Required             []string
	}
	if err := json.Unmarshal(tool.Function.Parameters, &schema); err != nil {
		t.Fatal(err)
	}
	if schema.AdditionalProperties || schema.Properties["when"]["format"] != "date" || schema.Properties["seen"]["type"] != "boolean" || len(schema.Required) != 3 {
		t.Fatal(schema)
	}
}

func TestChatActionScopeAndTextWrappers(t *testing.T) {
	db, service := storeAt(t, ":memory:")
	defer db.Close()
	_, i := setup(t, service)
	scope := persistence.MiniAppScope{Instance: i.ID, Release: i.ReleaseID, Revision: i.Revision, Actions: []string{"inbox.queue"}}
	actions, err := service.ChatActions(t.Context(), scope)
	if err != nil || len(actions.Tools) != 1 {
		t.Fatal(actions, err)
	}
	raw := `{"action":"choice_1","inputs":{}}`
	for _, body := range []string{raw, "Suggested:\n```json\n" + raw + "\n```", "Suggestion: " + raw + "\nDone."} {
		if _, err := actions.Normalize(body); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{"[" + raw + "]", raw + " or " + raw, `{"action":"choice_2","inputs":{}}`} {
		if _, err := actions.Normalize(body); err == nil {
			t.Fatal("accepted ambiguous or unselected action")
		}
	}
	scope.Revision++
	if _, err := service.ChatActions(t.Context(), scope); err == nil {
		t.Fatal("accepted stale instance scope")
	}
}

func TestStaleTurnCannotRunNewInstanceRevision(t *testing.T) {
	db, s := storeAt(t, ":memory:")
	defer db.Close()
	_, i := setup(t, s)
	scope := persistence.MiniAppScope{Instance: i.ID, Release: i.ReleaseID, Revision: i.Revision, Actions: []string{"inbox.queue"}}
	query := read("inbox.queue")
	query.ExpectedRevision = i.Revision
	rows := call(t, s, i.ID, query).Records
	if len(rows) == 0 {
		t.Fatal("expected a record")
	}
	if _, err := s.Configure(t.Context(), i.ID, ConfigRequest{Revision: i.Revision, Enabled: true, Grants: i.Grants}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChatActions(t.Context(), scope); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.Invoke(t.Context(), i.ID, query); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	transfer := AttachmentRequest{ExpectedRevision: i.Revision, Surface: "chat", Action: "inbox.queue", Records: []RecordRef{{ID: rows[0].ID, Revision: rows[0].Revision}}}
	if _, err := s.Attach(t.Context(), i.ID, transfer); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
