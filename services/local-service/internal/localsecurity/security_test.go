package localsecurity

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLaunchTokenExpiresAfterFortyFiveSeconds(t *testing.T) {
	clock := &securityTestClock{now: time.Date(2026, time.September, 10, 0, 0, 0, 0, time.UTC)}
	manager := New(clock.Now, nil)
	manager.RegisterLaunchToken("launch-token")

	clock.Advance(LaunchTokenTTL + time.Nanosecond)
	if _, err := manager.ConsumeLaunchToken("launch-token"); !errors.Is(err, ErrInvalidLaunchToken) {
		t.Fatalf("consume expired launch token error = %v, want %v", err, ErrInvalidLaunchToken)
	}
}

func TestSessionExpiresAfterIdleOrAbsoluteLimitAndRestart(t *testing.T) {
	clock := &securityTestClock{now: time.Date(2026, time.September, 10, 0, 0, 0, 0, time.UTC)}
	manager := New(clock.Now, nil)
	manager.RegisterLaunchToken("launch-token")
	session, err := manager.ConsumeLaunchToken("launch-token")
	if err != nil {
		t.Fatalf("consume launch token: %v", err)
	}

	clock.Advance(SessionIdleTTL + time.Nanosecond)
	if _, err := manager.Session(session.ID); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("read idle session error = %v, want %v", err, ErrInvalidSession)
	}

	manager.RegisterLaunchToken("second-launch-token")
	activeSession, err := manager.ConsumeLaunchToken("second-launch-token")
	if err != nil {
		t.Fatalf("consume second launch token: %v", err)
	}
	for range 24 {
		clock.Advance(29 * time.Minute)
		if _, err := manager.Session(activeSession.ID); err != nil {
			t.Fatalf("refresh active session: %v", err)
		}
	}
	clock.Advance(25 * time.Minute)
	if _, err := manager.Session(activeSession.ID); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("read absolute-expired session error = %v, want %v", err, ErrInvalidSession)
	}

	manager.RegisterLaunchToken("third-launch-token")
	newSession, err := manager.ConsumeLaunchToken("third-launch-token")
	if err != nil {
		t.Fatalf("consume third launch token: %v", err)
	}
	manager.InvalidateSessions()
	if _, err := manager.Session(newSession.ID); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("read post-restart session error = %v, want %v", err, ErrInvalidSession)
	}
}

func TestHTTPMiddlewareProtectsLoopbackBrowserAndControlBoundaries(t *testing.T) {
	manager := New(nil, tokenSequence("session-id", "csrf-token"))
	manager.RegisterLaunchToken("launch-token")
	session, err := manager.ConsumeLaunchToken("launch-token")
	if err != nil {
		t.Fatalf("consume launch token: %v", err)
	}

	var rejected error
	reject := func(writer http.ResponseWriter, _ *http.Request, err error) {
		rejected = err
		writer.WriteHeader(http.StatusUnauthorized)
	}
	called := false
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	})

	foreignHost := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47123/api/health", nil)
	foreignHost.Host = "chat.example.test"
	loopbackResponse := httptest.NewRecorder()
	RequireLoopbackHost(reject)(next).ServeHTTP(loopbackResponse, foreignHost)
	if loopbackResponse.Code != http.StatusUnauthorized || !errors.Is(rejected, ErrInvalidHost) || called {
		t.Fatalf("loopback middleware response = %d, rejection = %v, called = %t", loopbackResponse.Code, rejected, called)
	}

	rejected = nil
	mutation := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/api/session", nil)
	mutation.Host = "127.0.0.1:47123"
	mutation.Header.Set("Origin", "http://127.0.0.1:47123")
	mutation.Header.Set("X-Cove-CSRF-Token", session.CSRFToken)
	mutation.AddCookie(&http.Cookie{Name: "cove_session", Value: session.ID})
	mutationResponse := httptest.NewRecorder()
	manager.RequireBrowserMutations("cove_session", reject)(next).ServeHTTP(mutationResponse, mutation)
	if rejected != nil || !called {
		t.Fatalf("browser mutation rejection = %v, called = %t", rejected, called)
	}

	called = false
	rejected = nil
	control := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47123/internal/control/shutdown", nil)
	control.Host = "127.0.0.1:47123"
	control.Header.Set("X-Cove-Control-Token", "wrong-token")
	controlResponse := httptest.NewRecorder()
	RequireControlToken("control-token", reject)(next).ServeHTTP(controlResponse, control)
	if controlResponse.Code != http.StatusUnauthorized || !errors.Is(rejected, ErrInvalidControlToken) || called {
		t.Fatalf("control middleware response = %d, rejection = %v, called = %t", controlResponse.Code, rejected, called)
	}
}

func tokenSequence(tokens ...string) TokenSource {
	next := 0
	return func() (string, error) {
		token := tokens[next]
		next++
		return token, nil
	}
}

type securityTestClock struct {
	now time.Time
}

func (clock *securityTestClock) Now() time.Time {
	return clock.now
}

func (clock *securityTestClock) Advance(duration time.Duration) {
	clock.now = clock.now.Add(duration)
}
