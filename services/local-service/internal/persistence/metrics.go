package persistence

import "errors"

// GenerationMetrics are observed timings and optional Provider-reported token counts.
// Browser timings describe the browser inference path, including verification.
type GenerationMetrics struct {
	Source             string `json:"source"`
	DurationMS         int64  `json:"duration_ms"`
	TimeToFirstTokenMS *int64 `json:"time_to_first_token_ms,omitempty"`
	OutputDurationMS   *int64 `json:"output_duration_ms,omitempty"`
	InputTokens        *int64 `json:"input_tokens,omitempty"`
	OutputTokens       *int64 `json:"output_tokens,omitempty"`
}

func validateGenerationMetrics(metrics *GenerationMetrics) error {
	if metrics == nil {
		return nil
	}
	if (metrics.Source != "service" && metrics.Source != "browser") || metrics.DurationMS < 0 || metrics.DurationMS > 24*60*60*1000 {
		return errors.New("generation metrics are invalid")
	}
	for _, value := range []*int64{metrics.TimeToFirstTokenMS, metrics.OutputDurationMS} {
		if value != nil && (*value < 0 || *value > metrics.DurationMS) {
			return errors.New("generation timing is invalid")
		}
	}
	for _, value := range []*int64{metrics.InputTokens, metrics.OutputTokens} {
		if value != nil && (*value < 0 || *value > 1_000_000_000) {
			return errors.New("generation token usage is invalid")
		}
	}
	if metrics.TimeToFirstTokenMS != nil && metrics.OutputDurationMS != nil && *metrics.TimeToFirstTokenMS+*metrics.OutputDurationMS > metrics.DurationMS {
		return errors.New("generation timing intervals exceed the total duration")
	}
	return nil
}
