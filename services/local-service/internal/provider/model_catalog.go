package provider

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

type catalogModel struct {
	ID                  string          `json:"id"`
	Name                string          `json:"name"`
	OwnedBy             string          `json:"owned_by"`
	Description         string          `json:"description"`
	IsReady             *bool           `json:"is_ready"`
	PrivacyMode         string          `json:"privacy_mode"`
	Verifiable          *bool           `json:"verifiable"`
	Provider            string          `json:"provider"`
	ProviderType        string          `json:"provider_type"`
	ContextLength       json.RawMessage `json:"context_length"`
	MaxOutputLength     json.RawMessage `json:"max_output_length"`
	InputModalities     []string        `json:"input_modalities"`
	OutputModalities    []string        `json:"output_modalities"`
	SupportedFeatures   []string        `json:"supported_features"`
	SupportedParameters []string        `json:"supported_parameters"`
	Architecture        struct {
		InputModalities  []string `json:"input_modalities"`
		OutputModalities []string `json:"output_modalities"`
		InputCamel       []string `json:"inputModalities"`
		OutputCamel      []string `json:"outputModalities"`
	} `json:"architecture"`
	TopProvider struct {
		ContextLength       json.RawMessage `json:"context_length"`
		MaxCompletionTokens json.RawMessage `json:"max_completion_tokens"`
	} `json:"top_provider"`
	Pricing struct {
		Prompt     json.RawMessage `json:"prompt"`
		Completion json.RawMessage `json:"completion"`
		Input      json.RawMessage `json:"input"`
		Output     json.RawMessage `json:"output"`
	} `json:"pricing"`
}

func catalogNumber(raw json.RawMessage) *float64 {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return nil
	}
	var result float64
	switch number := value.(type) {
	case float64:
		result = number
	case string:
		parsed, err := strconv.ParseFloat(number, 64)
		if err != nil {
			return nil
		}
		result = parsed
	default:
		return nil
	}
	if math.IsNaN(result) || math.IsInf(result, 0) || result < 0 {
		return nil
	}
	return &result
}

func catalogTokens(values ...json.RawMessage) *int64 {
	for _, raw := range values {
		if value := catalogNumber(raw); value != nil && *value >= 1 && *value <= 1_000_000_000 && math.Trunc(*value) == *value {
			count := int64(*value)
			return &count
		}
	}
	return nil
}

func catalogPrice(perToken, perMillion json.RawMessage, nearAI bool) *float64 {
	value := catalogNumber(perToken)
	if value != nil {
		converted := *value * 1_000_000
		value = &converted
	} else if nearAI {
		value = catalogNumber(perMillion)
	}
	if value != nil && *value <= 1_000_000_000 {
		return value
	}
	return nil
}

func enrichModelMetadata(metadata ModelMetadata, model catalogModel, nearAI bool) ModelMetadata {
	metadata.Name = boundedCatalogText(model.Name, 240)
	metadata.Owner = boundedCatalogText(model.OwnedBy, 120)
	metadata.Description = boundedCatalogText(model.Description, 2000)
	metadata.ContextLength = catalogTokens(model.ContextLength, model.TopProvider.ContextLength)
	metadata.MaxOutputTokens = catalogTokens(model.MaxOutputLength, model.TopProvider.MaxCompletionTokens)
	metadata.InputPricePerMillion = catalogPrice(model.Pricing.Prompt, model.Pricing.Input, nearAI)
	metadata.OutputPricePerMillion = catalogPrice(model.Pricing.Completion, model.Pricing.Output, nearAI)
	seen := make(map[string]bool)
	add := func(value string) {
		if !seen[value] {
			metadata.Capabilities = append(metadata.Capabilities, value)
			seen[value] = true
		}
	}
	for _, modality := range append(append(model.InputModalities, model.Architecture.InputModalities...), model.Architecture.InputCamel...) {
		switch modality {
		case "text", "image", "audio", "video":
			add(modality + "_input")
		}
	}
	for _, modality := range append(append(model.OutputModalities, model.Architecture.OutputModalities...), model.Architecture.OutputCamel...) {
		switch modality {
		case "image", "audio", "video":
			add(modality + "_output")
		}
	}
	for _, feature := range append(model.SupportedFeatures, model.SupportedParameters...) {
		switch feature {
		case "tools", "tool_choice":
			add("tools")
		case "structured_outputs":
			add("structured_outputs")
		case "json_mode", "response_format":
			add("json_mode")
		case "reasoning", "include_reasoning":
			add("reasoning")
		}
	}
	return metadata
}

func boundedCatalogText(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
