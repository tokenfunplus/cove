package runtime

import (
	"net"
	"strconv"
	"testing"
)

func TestListenPrefersConfiguredPortAndRecoversWithinRange(t *testing.T) {
	preferredPort := reservePort(t)

	preferred, err := Listen(ListenerConfig{
		PreferredPort: preferredPort,
		RecoveryStart: preferredPort + 1,
		RecoveryEnd:   preferredPort + 3,
	})
	if err != nil {
		t.Fatalf("listen on preferred port: %v", err)
	}
	if portOf(t, preferred) != preferredPort {
		preferred.Close()
		t.Fatalf("listener port = %d, want preferred port %d", portOf(t, preferred), preferredPort)
	}
	preferred.Close()

	blocker, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(preferredPort)))
	if err != nil {
		t.Fatalf("block preferred port: %v", err)
	}
	defer blocker.Close()

	recovered, err := Listen(ListenerConfig{
		PreferredPort: preferredPort,
		RecoveryStart: preferredPort + 1,
		RecoveryEnd:   preferredPort + 3,
	})
	if err != nil {
		t.Fatalf("recover from port conflict: %v", err)
	}
	defer recovered.Close()
	if port := portOf(t, recovered); port < preferredPort+1 || port > preferredPort+3 {
		t.Fatalf("recovered port = %d, want within %d-%d", port, preferredPort+1, preferredPort+3)
	}
}

func TestDefaultListenerConfigUsesTheTicketSevenLoopbackRange(t *testing.T) {
	config := DefaultListenerConfig()

	if config.PreferredPort != 19421 || config.RecoveryStart != 19421 || config.RecoveryEnd != 19521 {
		t.Fatalf("default listener config = %#v, want preferred 19421 and recovery range 19421-19521", config)
	}
}

func reservePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer listener.Close()
	return portOf(t, listener)
}

func portOf(t *testing.T, listener net.Listener) int {
	t.Helper()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatalf("split listener address: %v", err)
	}
	value, err := strconv.Atoi(port)
	if err != nil {
		t.Fatalf("parse listener port: %v", err)
	}
	return value
}
