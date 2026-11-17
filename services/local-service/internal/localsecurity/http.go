package localsecurity

import (
	"context"
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"strings"
)

var (
	ErrInvalidHost         = errors.New("invalid loopback host")
	ErrInvalidOrigin       = errors.New("invalid browser origin")
	ErrInvalidCSRF         = errors.New("invalid CSRF token")
	ErrInvalidControlToken = errors.New("invalid control token")
)

const SessionHeader = "X-Cove-Session-Token"

type RejectionWriter func(http.ResponseWriter, *http.Request, error)

type sessionContextKey struct{}

func ValidateLoopbackHost(hostHeader string) error {
	host, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		host = hostHeader
	}
	if host != "127.0.0.1" && host != "localhost" {
		return ErrInvalidHost
	}
	return nil
}

func (manager *Manager) BrowserSession(request *http.Request) (Session, error) {
	return manager.Session(request.Header.Get(SessionHeader))
}

func (manager *Manager) ValidateBrowserMutation(request *http.Request) (Session, error) {
	session, err := manager.BrowserSession(request)
	if err != nil {
		return Session{}, err
	}
	if request.Header.Get("Origin") != "http://"+request.Host {
		return Session{}, ErrInvalidOrigin
	}
	if subtle.ConstantTimeCompare([]byte(request.Header.Get("X-Cove-CSRF-Token")), []byte(session.CSRFToken)) != 1 {
		return Session{}, ErrInvalidCSRF
	}
	return session, nil
}

func RequireLoopbackHost(reject RejectionWriter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if err := ValidateLoopbackHost(request.Host); err != nil {
				reject(writer, request, err)
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func (manager *Manager) RequireBrowserSession(reject RejectionWriter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			_, ok := SessionFromRequest(request)
			if ok {
				next.ServeHTTP(writer, request)
				return
			}
			session, err := manager.BrowserSession(request)
			if err != nil {
				reject(writer, request, err)
				return
			}
			next.ServeHTTP(writer, request.WithContext(context.WithValue(request.Context(), sessionContextKey{}, session)))
		})
	}
}

func (manager *Manager) RequireBrowserMutations(reject RejectionWriter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if !strings.HasPrefix(request.URL.Path, "/api/") || IsSafeMethod(request.Method) {
				next.ServeHTTP(writer, request)
				return
			}
			session, err := manager.ValidateBrowserMutation(request)
			if err != nil {
				reject(writer, request, err)
				return
			}
			next.ServeHTTP(writer, request.WithContext(context.WithValue(request.Context(), sessionContextKey{}, session)))
		})
	}
}

func RequireControlToken(expected string, reject RejectionWriter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if !ValidControlToken(request.Header.Get("X-Cove-Control-Token"), expected) {
				reject(writer, request, ErrInvalidControlToken)
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func SessionFromRequest(request *http.Request) (Session, bool) {
	session, ok := request.Context().Value(sessionContextKey{}).(Session)
	return session, ok
}

func ValidControlToken(provided, expected string) bool {
	return expected != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func IsSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}
