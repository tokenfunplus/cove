package chat

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestSlowSubscriberDoesNotBlockGenerationOrHealthySubscribers(t *testing.T) {
	for _, kind := range []string{"generation", "batch"} {
		t.Run(kind, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var publish func(GenerationEvent)
			var subscribe func(string) <-chan GenerationEvent
			if kind == "batch" {
				hub := newBatchEventHub()
				hub.activate("batch", 1)
				publish = func(event GenerationEvent) { hub.publish(event, event.Type == EventCompleted) }
				subscribe = func(after string) <-chan GenerationEvent { return hub.subscribe(ctx, "batch", after, false) }
			} else {
				hub := newEventHub()
				publish = hub.publish
				subscribe = func(after string) <-chan GenerationEvent { return hub.subscribe(ctx, "generation", after, false) }
			}
			slow, healthy := subscribe(""), subscribe("")
			done := make(chan struct{})
			go func() {
				defer close(done)
				for i := 1; i <= 300; i++ {
					event := GenerationEvent{EventID: fmt.Sprint(i), BatchID: "batch", TargetID: "target", GenerationID: "generation", Type: EventDelta, Delta: "x"}
					if i == 300 {
						event.Type = EventCompleted
					}
					publish(event)
					if got := <-healthy; got.EventID != event.EventID {
						t.Errorf("healthy subscriber got event %q, want %q", got.EventID, event.EventID)
						return
					}
				}
			}()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("slow subscriber blocked generation")
			}
			if _, open := <-healthy; open {
				t.Fatal("terminal event did not close healthy subscriber")
			}
			lastID, count := "", 0
			for event := range slow {
				lastID = event.EventID
				count++
			}
			if count != 256 {
				t.Fatalf("slow subscriber retained %d events, want 256", count)
			}
			for event := range subscribe(lastID) {
				count++
				if event.EventID != fmt.Sprint(count) {
					t.Fatalf("replay got %q, want %d", event.EventID, count)
				}
			}
			if count != 300 {
				t.Fatalf("replay recovered %d events, want 300", count)
			}
		})
	}
}
