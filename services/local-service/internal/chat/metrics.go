package chat

import (
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

type generationMeasurement struct {
	started time.Time
	first   time.Time
	last    time.Time
	usage   *provider.TokenUsage
}

func (measurement *generationMeasurement) observe(event provider.Event) {
	if event.Usage != nil {
		measurement.usage = event.Usage
	}
	if event.Delta != "" || event.ReasoningDelta != "" {
		measurement.last = time.Now()
		if measurement.first.IsZero() {
			measurement.first = measurement.last
		}
	}
}

func (measurement *generationMeasurement) snapshot() *persistence.GenerationMetrics {
	metrics := &persistence.GenerationMetrics{Source: "service", DurationMS: time.Since(measurement.started).Milliseconds()}
	if !measurement.first.IsZero() {
		first, output := measurement.first.Sub(measurement.started).Milliseconds(), measurement.last.Sub(measurement.first).Milliseconds()
		metrics.TimeToFirstTokenMS, metrics.OutputDurationMS = &first, &output
	}
	if measurement.usage != nil {
		metrics.InputTokens, metrics.OutputTokens = measurement.usage.InputTokens, measurement.usage.OutputTokens
	}
	return metrics
}
