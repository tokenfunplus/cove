package runtime

import (
	"bytes"
	"encoding/json"
	"net"
	"testing"
)

func TestWriteReadinessPublishesActualLoopbackAddressAndLaunchToken(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	var output bytes.Buffer
	if err := WriteReadiness(&output, listener.Addr(), "launch-token"); err != nil {
		t.Fatalf("write readiness: %v", err)
	}

	var readiness struct {
		URL         string `json:"url"`
		LaunchToken string `json:"launch_token"`
	}
	if err := json.Unmarshal(output.Bytes(), &readiness); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if readiness.URL != "http://"+listener.Addr().String() {
		t.Fatalf("readiness URL = %q, want %q", readiness.URL, "http://"+listener.Addr().String())
	}
	if readiness.LaunchToken != "launch-token" {
		t.Fatalf("readiness launch token = %q, want launch-token", readiness.LaunchToken)
	}
}
