package miniapps

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

type RecordRef struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}
type Record struct {
	ID       string         `json:"id"`
	Revision int64          `json:"revision"`
	Fields   map[string]any `json:"fields"`
}
type Invocation struct {
	Cursor      string           `json:"cursor,omitempty"`
	Items       []map[string]any `json:"items,omitempty"`
	Action      string           `json:"action"`
	Surface     string           `json:"surface"`
	OperationID string           `json:"operation_id"`
	Inputs      map[string]any   `json:"inputs"`
	Records     []RecordRef      `json:"records,omitempty"`
	Confirm     string           `json:"confirm,omitempty"`
}
type Result struct {
	NextCursor   string   `json:"next_cursor,omitempty"`
	Records      []Record `json:"records"`
	Confirmation string   `json:"confirmation,omitempty"`
	Prompt       string   `json:"prompt,omitempty"`
}

var operationID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,96}$`)

func loadRecords(tx *persistence.MiniAppStore, id, col string) ([]Record, error) {
	rows, err := tx.Records(id, col)
	if err != nil {
		return nil, err
	}
	result := make([]Record, 0, len(rows))
	for _, row := range rows {
		r := Record{ID: row.ID, Revision: row.Revision}
		if err := json.Unmarshal(row.Fields, &r.Fields); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, nil
}
func saveRecord(tx *persistence.MiniAppStore, id, col string, r Record) error {
	data, err := json.Marshal(r.Fields)
	if err != nil {
		return err
	}
	if len(data) > 96<<10 {
		return invalid("record size limit")
	}
	return tx.SaveRecord(id, col, persistence.AppRecord{ID: r.ID, Revision: r.Revision, Fields: data})
}
func compare(x, y any) int {
	switch a := x.(type) {
	case string:
		return strings.Compare(a, y.(string))
	case float64:
		return cmp.Compare(a, y.(float64))
	case bool:
		b := y.(bool)
		if a == b {
			return 0
		}
		if a {
			return 1
		}
		return -1
	}
	return 0
}
func include(row Record, a Action, inputs map[string]any, now time.Time) bool {
	for _, w := range a.Where {
		n := compare(row.Fields[w.Field], resolve(w.Value, inputs, now))
		if !comparison(n, w.Op) {
			return false
		}
	}
	return true
}
func queryRecords(rows []Record, a Action, inputs map[string]any, now time.Time) []Record {
	selected := []Record{}
	for _, r := range rows {
		if include(r, a, inputs, now) {
			selected = append(selected, r)
		}
	}
	if k := a.OrderBy; k != "" {
		slices.SortStableFunc(selected, func(x, y Record) int { return compare(x.Fields[k], y.Fields[k]) })
	}
	// Rows arrive in creation order, the stable tiebreaker for equal sort values.
	if a.Limit > 0 {
		selected = selected[:min(len(selected), a.Limit)]
	}
	return selected
}

// Cursors identify a prefix of the current ordered result. A change to a
// previously loaded page requires a refresh before appending more records.
func queryPage(records []Record, limit int, cursor string) (Result, error) {
	pageSize := max(50, limit) // Preserve the full result of existing explicitly capped actions.
	fingerprint := sha256.New()
	current := ""
	for start := 0; ; start += pageSize {
		end := min(start+pageSize, len(records))
		page := records[start:end]
		next := ""
		if end < len(records) {
			for _, row := range page {
				fmt.Fprintf(fingerprint, "%s:%d\n", row.ID, row.Revision)
			}
			next = hex.EncodeToString(fingerprint.Sum(nil))
		}
		if current == cursor {
			return Result{Records: page, NextCursor: next}, nil
		}
		if next == "" {
			return Result{}, ErrConflict
		}
		current = next
	}
}
func inputOK(inputs map[string]any, fields map[string]string) bool {
	if len(inputs) != len(fields) {
		return false
	}
	for k, v := range inputs {
		if !matches(v, fields[k]) {
			return false
		}
	}
	return true
}
func generate(p Package, a Action, inputs map[string]any) Result {
	instruction := a.Prompt
	if a.CandidateAction != "" {
		schema, _ := json.Marshal(p.Actions[a.CandidateAction].Inputs)
		instruction += fmt.Sprintf("\nReturn only a JSON array of candidate objects, each matching these named fields and types: %s.", schema)
	}
	if len(inputs) > 1 {
		parameters := maps.Clone(inputs)
		delete(parameters, a.TextInput)
		// Invoke has already validated the values as finite JSON scalars.
		encoded, _ := json.Marshal(parameters)
		instruction += "\n\nUser-selected parameters (JSON):\n" + string(encoded)
	}
	return Result{Records: []Record{}, Prompt: instruction + "\n\nSource material:\n" + inputs[a.TextInput].(string)}
}
func (s *Service) Invoke(ctx context.Context, id string, req Invocation) (Result, error) {
	var out Result
	if !operationID.MatchString(req.OperationID) {
		return out, invalid("operation ID")
	}
	err := s.store.MiniAppTransaction(ctx, func(tx *persistence.MiniAppStore) error {
		i, err := loadInstance(tx, id)
		if err != nil {
			return err
		}
		if !i.Enabled {
			return ErrDenied
		}
		r, err := loadRelease(tx, i.ReleaseID)
		if err != nil {
			return err
		}
		a, ok := r.Package.Actions[req.Action]
		if !ok {
			return ErrNotFound
		}
		if !slices.Contains(a.Surfaces, req.Surface) || !slices.Contains(i.Grants, capability(a.Op)) {
			return ErrDenied
		}
		if req.Cursor != "" && (a.Op != "query" || len(req.Cursor) != sha256.Size*2) {
			return invalid("query cursor")
		}
		if req.Items != nil {
			if a.Op != "create" || len(req.Inputs) != 0 || len(req.Items) == 0 || len(req.Items) > 50 {
				return invalid("batch creation requires one to fifty input objects")
			}
			for _, item := range req.Items {
				if !inputOK(item, a.Inputs) {
					return invalid("invalid item in create batch")
				}
			}
		} else if !inputOK(req.Inputs, a.Inputs) {
			return invalid("action inputs")
		}
		if a.Op != "update" && len(req.Records) > 0 {
			return invalid("unexpected record selection")
		}
		if (a.Op == "query" || a.Op == "generate") && req.Confirm != "" {
			return invalid("unexpected confirmation")
		}
		if a.Op == "generate" {
			out = generate(r.Package, a, req.Inputs)
			return nil
		}
		rows, err := loadRecords(tx, id, a.Collection)
		if err != nil {
			return err
		}
		now := s.now()
		if a.Op == "query" {
			out, err = queryPage(queryRecords(rows, a, req.Inputs, now), a.Limit, req.Cursor)
			return err
		}
		out, err = s.write(tx, i, a, rows, req, now)
		return err
	})
	return out, err
}
func (s *Service) write(tx *persistence.MiniAppStore, i Instance, a Action, rows []Record, req Invocation, now time.Time) (Result, error) {
	var out Result
	// Bind approval and replay to the instance, immutable release, caller and original input.
	confirm := req.Confirm
	req.Confirm = ""
	requestData, err := json.Marshal(req)
	if err != nil {
		return out, err
	}
	fingerprint := digest([]byte(i.ID + "/" + i.ReleaseID + "/" + string(requestData)))
	receipt := digest([]byte(fingerprint + "/" + confirm))
	prior, result, err := tx.Invocation(i.ID, req.OperationID)
	if err == nil {
		if prior != receipt {
			return out, ErrConflict
		}
		err = json.Unmarshal(result, &out)
		return out, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	proposed, err := propose(i.ID, rows, a, req, now)
	if err != nil {
		return out, err
	}
	out.Records = proposed
	encoded, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	if len(encoded) > 1<<20 {
		return Result{}, invalid("operation output limit")
	}
	mac := hmac.New(sha256.New, s.secret[:])
	fmt.Fprintf(mac, "%s/%d/", fingerprint, i.Revision)
	mac.Write(encoded)
	preview := hex.EncodeToString(mac.Sum(nil))
	if confirm == "" {
		out.Confirmation = preview
		return out, nil
	}
	if !hmac.Equal([]byte(preview), []byte(confirm)) {
		return Result{}, ErrConflict
	}
	if a.Op == "create" {
		count, err := tx.RecordCount(i.ID)
		if err != nil {
			return out, err
		}
		if count+len(proposed) > maxRecords {
			return out, invalid("instance record limit")
		}
	}
	for _, r := range proposed {
		if err := saveRecord(tx, i.ID, a.Collection, r); err != nil {
			return Result{}, err
		}
	}
	size, err := tx.InstanceRecordBytes(i.ID)
	if err != nil {
		return Result{}, err
	}
	if size > 16<<20 {
		return Result{}, invalid("instance storage limit")
	}
	return out, tx.SaveInvocation(i.ID, req.OperationID, receipt, encoded)
}
func propose(id string, rows []Record, a Action, req Invocation, now time.Time) ([]Record, error) {
	var proposed []Record
	switch a.Op {
	case "create":
		inputs := req.Items
		if inputs == nil {
			inputs = []map[string]any{req.Inputs}
		}
		for n, values := range inputs {
			identity := id + "/" + req.OperationID
			if n > 0 {
				identity += "/" + strconv.Itoa(n)
			}
			record := Record{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(identity)).String(), Revision: 1, Fields: map[string]any{}}
			for key, expression := range a.Values {
				record.Fields[key] = resolve(expression, values, now)
			}
			proposed = append(proposed, record)
		}
		return proposed, nil
	case "update":
		if len(req.Records) == 0 || len(req.Records) > 50 {
			return nil, invalid("select between one and fifty records")
		}
		byID := map[string]Record{}
		for _, r := range rows {
			byID[r.ID] = r
		}
		for _, ref := range req.Records {
			r, ok := byID[ref.ID]
			if !ok || r.Revision != ref.Revision {
				return nil, ErrConflict
			}
			delete(byID, ref.ID)
			r.Revision++
			proposed = append(proposed, r)
		}
	}
	for index, r := range proposed {
		// All assignments evaluate against the same pre-operation record.
		updated := maps.Clone(r.Fields)
		for k, v := range a.Values {
			value, err := evalRule(v, r.Fields, req.Inputs, now)
			if err != nil {
				return nil, err
			}
			updated[k] = value
		}
		proposed[index].Fields = updated
	}
	return proposed, nil
}
