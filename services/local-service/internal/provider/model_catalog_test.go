package provider

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestCatalogMetadataNormalizesAdvertisedFields(t *testing.T) {
	var model catalogModel
	if err := json.Unmarshal([]byte(`{"id":"deepseek/fixture","owned_by":"deepseek","name":"DeepSeek Fixture","context_length":1048576,"max_output_length":65536,"pricing":{"prompt":"0.0000003","completion":"0.0000012"},"architecture":{"inputModalities":["text","image"],"outputModalities":["text"]},"input_modalities":["text"],"supported_features":["tools","reasoning","json_mode"],"supported_parameters":["tool_choice","response_format","unknown"]}`), &model); err != nil {
		t.Fatal(err)
	}
	metadata := enrichModelMetadata(classifyModelMetadata(model.ID, model.OwnedBy, "", "", "", "", nil), model, true)
	if metadata.Name != "DeepSeek Fixture" || metadata.Owner != "deepseek" || metadata.ContextLength == nil || *metadata.ContextLength != 1048576 || metadata.MaxOutputTokens == nil || *metadata.MaxOutputTokens != 65536 {
		t.Fatalf("metadata = %#v", metadata)
	}
	if metadata.InputPricePerMillion == nil || *metadata.InputPricePerMillion != 0.3 || metadata.OutputPricePerMillion == nil || *metadata.OutputPricePerMillion != 1.2 {
		t.Fatalf("price units = %#v", metadata)
	}
	if !reflect.DeepEqual(metadata.Capabilities, []string{"text_input", "image_input", "tools", "reasoning", "json_mode"}) || metadata.Verifiable {
		t.Fatalf("capabilities or transport = %#v", metadata)
	}
}

func TestCatalogMissingInvalidAndFreePricesRemainDistinct(t *testing.T) {
	for _, fixture := range []struct {
		payload string
		nearAI  bool
		want    *float64
	}{
		{`{"pricing":{"input":0,"output":1.2}}`, true, floatPtr(0)},
		{`{"pricing":{"input":0.3}}`, false, nil},
		{`{"pricing":{"prompt":"-1","completion":"NaN"},"context_length":-1}`, false, nil},
		{`{}`, true, nil},
	} {
		var model catalogModel
		if err := json.Unmarshal([]byte(fixture.payload), &model); err != nil {
			t.Fatal(err)
		}
		metadata := enrichModelMetadata(ModelMetadata{}, model, fixture.nearAI)
		if !reflect.DeepEqual(metadata.InputPricePerMillion, fixture.want) || metadata.ContextLength != nil {
			t.Fatalf("%s = %#v", fixture.payload, metadata)
		}
	}
	var model catalogModel
	if err := json.Unmarshal([]byte(`{"top_provider":{"context_length":"200000","max_completion_tokens":16000},"architecture":{"input_modalities":["text","image"],"output_modalities":["image"]},"pricing":{"prompt":"0","completion":"0.000002"}}`), &model); err != nil {
		t.Fatal(err)
	}
	metadata := enrichModelMetadata(ModelMetadata{}, model, false)
	if metadata.ContextLength == nil || *metadata.ContextLength != 200000 || metadata.InputPricePerMillion == nil || *metadata.InputPricePerMillion != 0 || metadata.OutputPricePerMillion == nil || *metadata.OutputPricePerMillion != 2 || !reflect.DeepEqual(metadata.Capabilities, []string{"text_input", "image_input", "image_output"}) {
		t.Fatalf("OpenRouter-shaped catalog = %#v", metadata)
	}
}

func floatPtr(value float64) *float64 { return &value }
