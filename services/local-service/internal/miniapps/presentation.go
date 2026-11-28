package miniapps

import (
	"bytes"
	"encoding/json"
	"slices"
)

// Preserve authored presentation order across decoding, storage reads and API
// responses. Package digests still refer to the untouched original bytes.
func (a *Action) UnmarshalJSON(raw []byte) error {
	type plain Action
	var value plain
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	order, err := declaredFieldOrder(raw, "inputs")
	if err != nil {
		return err
	}
	*a = Action(value)
	a.inputOrder = order
	return nil
}

func (a Action) MarshalJSON() ([]byte, error) {
	type plain Action
	return json.Marshal(struct {
		plain
		Inputs orderedFieldTypes `json:"inputs"`
	}{plain(a), orderedFieldTypes{a.Inputs, a.inputOrder}})
}

func (c *Collection) UnmarshalJSON(raw []byte) error {
	type plain Collection
	var value plain
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	order, err := declaredFieldOrder(raw, "fields")
	if err != nil {
		return err
	}
	*c = Collection(value)
	c.fieldOrder = order
	return nil
}

func (c Collection) MarshalJSON() ([]byte, error) {
	type plain Collection
	return json.Marshal(struct {
		plain
		Fields orderedFieldTypes `json:"fields"`
	}{plain(c), orderedFieldTypes{c.Fields, c.fieldOrder}})
}

func declaredFieldOrder(raw []byte, member string) ([]string, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil {
		return nil, err
	}
	fields := members[member]
	if len(fields) == 0 || bytes.Equal(fields, []byte("null")) {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(fields))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var order []string
	for dec.More() {
		name, err := dec.Token()
		if err != nil {
			return nil, err
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		order = append(order, name.(string))
	}
	return order, nil
}

type orderedFieldTypes struct {
	fields map[string]string
	order  []string
}

func (fields orderedFieldTypes) MarshalJSON() ([]byte, error) {
	if fields.fields == nil {
		return []byte("null"), nil
	}
	keys := make([]string, 0, len(fields.fields))
	seen := make(map[string]bool, len(fields.fields))
	for _, key := range fields.order {
		if _, exists := fields.fields[key]; exists && !seen[key] {
			keys = append(keys, key)
			seen[key] = true
		}
	}
	var added []string
	for key := range fields.fields {
		if !seen[key] {
			added = append(added, key)
		}
	}
	slices.Sort(added)
	keys = append(keys, added...)
	var out bytes.Buffer
	out.WriteByte('{')
	for index, key := range keys {
		if index > 0 {
			out.WriteByte(',')
		}
		name, _ := json.Marshal(key)
		value, _ := json.Marshal(fields.fields[key])
		out.Write(name)
		out.WriteByte(':')
		out.Write(value)
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}
