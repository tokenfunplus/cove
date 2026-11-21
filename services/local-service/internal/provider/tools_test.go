package provider

import "testing"

func TestToolCallAccumulatorPreservesFragmentedArguments(t *testing.T) {
	var accumulator ToolCallAccumulator
	call := ToolCall{ID: "call-1", Type: "function"}
	call.Function.Name = "web_search"
	call.Function.Arguments = `{"query":"fresh`
	if err := accumulator.Add([]ToolCallDelta{{Index: 0, ToolCall: call}}); err != nil {
		t.Fatal(err)
	}
	call = ToolCall{}
	call.Function.Arguments = ` facts"}`
	if err := accumulator.Add([]ToolCallDelta{{Index: 0, ToolCall: call}}); err != nil {
		t.Fatal(err)
	}
	calls, err := accumulator.Calls()
	if err != nil || len(calls) != 1 || calls[0].Function.Arguments != `{"query":"fresh facts"}` {
		t.Fatal("tool arguments changed")
	}
	if err := accumulator.Add([]ToolCallDelta{{Index: 8}}); err == nil {
		t.Fatal("unbounded parallel tools accepted")
	}
}
