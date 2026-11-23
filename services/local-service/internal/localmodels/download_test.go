package localmodels

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestArtifactFetchValidatesRangeAndDoesNotAppendAnIgnoredRange(t *testing.T) {
	for _, mode := range []string{"range", "ignore", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Range") != "bytes=4-" {
					t.Error("missing resume range")
				}
				if mode == "ignore" {
					io.WriteString(w, "0123456789")
					return
				}
				if mode == "range" {
					w.Header().Set("Content-Range", "bytes 4-9/10")
				} else {
					w.Header().Set("Content-Range", "bytes 0-9/10")
				}
				w.WriteHeader(206)
				io.WriteString(w, "456789")
			}))
			defer server.Close()
			body, resumed, err := FetchArtifact(context.Background(), server.Client(), server.URL, 10, 4)
			if mode == "invalid" {
				if err == nil {
					body.Close()
					t.Fatal("malformed range accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer body.Close()
			if resumed != (mode == "range") {
				t.Fatal("incorrect resume disposition")
			}
		})
	}
}
