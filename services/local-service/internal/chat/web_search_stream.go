package chat

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

type webCompletionStream struct {
	service      *Service
	generation   persistence.Generation
	input        provider.CompletionInput
	stream       provider.CompletionStream
	tools        provider.ToolCallAccumulator
	body         strings.Builder
	reasoning    strings.Builder
	rounds       int
	usage        *provider.TokenUsage
	currentUsage *provider.TokenUsage
	closed       bool
}

func (stream *webCompletionStream) Close() error {
	stream.closed = true
	if stream.stream != nil {
		return stream.stream.Close()
	}
	return nil
}

func (stream *webCompletionStream) Recv(ctx context.Context) (provider.Event, error) {
	for {
		if stream.closed {
			return provider.Event{}, errors.New("web stream closed")
		}
		if stream.stream == nil {
			stream.input.Tools = websearch.Tools()
			if stream.rounds >= stream.generation.ConfigurationSnapshot.WebSearch.MaxRounds {
				stream.input.Tools = nil
				stream.input.Messages = append(stream.input.Messages, provider.ProviderMessage{Role: "system", Content: "The web tool budget has been reached. Finish using the available evidence, cite saved source sections, and state remaining gaps."})
			}
			characters := 0
			for _, message := range stream.input.Messages {
				characters += utf8.RuneCountInString(message.Content) + utf8.RuneCountInString(message.ReasoningContent) + len(message.ToolCallID)
				for _, call := range message.ToolCalls {
					characters += len(call.ID) + len(call.Function.Name) + utf8.RuneCountInString(call.Function.Arguments)
				}
			}
			if characters > 240000 {
				return provider.Event{}, errors.New("web tool context limit exceeded")
			}

			upstream, err := stream.service.provider.Stream(ctx, stream.input)
			if err != nil {
				return provider.Event{}, err
			}
			stream.stream = upstream
		}
		event, err := stream.stream.Recv(ctx)
		if err != nil {
			return provider.Event{}, err
		}
		if event.Usage != nil {
			stream.currentUsage = event.Usage
			event.Usage = nil
		}
		if event.Type == provider.EventDelta {
			if err := stream.tools.Add(event.ToolCalls); err != nil {
				return provider.Event{}, err
			}
			stream.body.WriteString(event.Delta)
			stream.reasoning.WriteString(event.ReasoningDelta)
			return event, nil
		}
		if event.Type != provider.EventCompleted {
			return event, nil
		}
		stream.usage = mergeToolUsage(stream.usage, stream.currentUsage, stream.rounds == 0)
		calls, err := stream.tools.Calls()
		if err != nil {
			return provider.Event{}, err
		}
		if len(calls) == 0 {
			event.Usage = stream.usage
			return event, nil
		}
		if len(stream.input.Tools) == 0 {
			return provider.Event{}, errors.New("the Provider continued tool calls after its budget")
		}
		_ = stream.stream.Close()
		stream.stream = nil
		stream.input.Messages = append(stream.input.Messages, provider.ProviderMessage{Role: "assistant", Content: stream.body.String(), ReasoningContent: stream.reasoning.String(), ToolCalls: calls})
		for _, call := range calls {
			result, err := stream.service.ExecuteWebTool(ctx, stream.generation.ID, WebToolInput{Call: call, Messages: stream.input.Messages})
			if err != nil {
				return provider.Event{}, err
			}
			stream.input.Messages = append(stream.input.Messages, provider.ProviderMessage{Role: "tool", ToolCallID: call.ID, Content: result.Content})
			stream.rounds++
		}
		stream.body.Reset()
		stream.reasoning.Reset()
		stream.tools = provider.ToolCallAccumulator{}
		stream.currentUsage = nil
		return provider.Event{Type: provider.EventWebActivity, Reset: true, WebActivity: "Preparing answer from web sources", Usage: stream.usage}, nil
	}
}

func mergeToolUsage(total, next *provider.TokenUsage, first bool) *provider.TokenUsage {
	if first {
		return next
	}
	merged := &provider.TokenUsage{}
	if total != nil && next != nil {
		if total.InputTokens != nil && next.InputTokens != nil {
			value := *total.InputTokens + *next.InputTokens
			merged.InputTokens = &value
		}
		if total.OutputTokens != nil && next.OutputTokens != nil {
			value := *total.OutputTokens + *next.OutputTokens
			merged.OutputTokens = &value
		}
	}
	return merged
}
