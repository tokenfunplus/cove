package provider

import "errors"

// ToolCallAccumulator joins streamed function arguments without interpreting answer text.
type ToolCallAccumulator struct{ calls map[int]ToolCall }

func (accumulator *ToolCallAccumulator) Add(deltas []ToolCallDelta) error {
	if accumulator.calls == nil {
		accumulator.calls = make(map[int]ToolCall)
	}
	for _, delta := range deltas {
		if delta.Index < 0 || delta.Index >= 8 {
			return errors.New("too many parallel tool calls")
		}
		call := accumulator.calls[delta.Index]
		if delta.ID != "" {
			call.ID += delta.ID
		}
		if delta.Type != "" {
			call.Type = delta.Type
		}
		call.Function.Name += delta.Function.Name
		call.Function.Arguments += delta.Function.Arguments
		if len(call.ID) > 200 || len(call.Function.Name) > 64 || len(call.Function.Arguments) > 16384 {
			return errors.New("tool call exceeds its limits")
		}
		accumulator.calls[delta.Index] = call
	}
	return nil
}

func (accumulator *ToolCallAccumulator) Calls() ([]ToolCall, error) {
	calls := make([]ToolCall, 0, len(accumulator.calls))
	for index := 0; index < 8; index++ {
		call, ok := accumulator.calls[index]
		if !ok {
			continue
		}
		if call.ID == "" || call.Function.Name == "" || call.Type != "function" {
			return nil, errors.New("incomplete function tool call")
		}
		calls = append(calls, call)
	}
	return calls, nil
}
