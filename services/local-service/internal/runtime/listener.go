// Package runtime contains the Local Service process-level runtime boundaries.
package runtime

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"syscall"
)

type ListenerConfig struct {
	PreferredPort int
	RecoveryStart int
	RecoveryEnd   int
}

const (
	DefaultPreferredPort = 19421
	DefaultRecoveryStart = 19421
	DefaultRecoveryEnd   = 19521
)

func DefaultListenerConfig() ListenerConfig {
	return ListenerConfig{
		PreferredPort: DefaultPreferredPort,
		RecoveryStart: DefaultRecoveryStart,
		RecoveryEnd:   DefaultRecoveryEnd,
	}
}

func Listen(config ListenerConfig) (net.Listener, error) {
	if err := validateConfig(config); err != nil {
		return nil, err
	}

	listener, err := listenOn(config.PreferredPort)
	if err == nil {
		return listener, nil
	}
	if !errors.Is(err, syscall.EADDRINUSE) {
		return nil, fmt.Errorf("listen on preferred port %d: %w", config.PreferredPort, err)
	}

	for port := config.RecoveryStart; port <= config.RecoveryEnd; port++ {
		if port == config.PreferredPort {
			continue
		}
		listener, err := listenOn(port)
		if err == nil {
			return listener, nil
		}
		if !errors.Is(err, syscall.EADDRINUSE) {
			return nil, fmt.Errorf("listen on recovery port %d: %w", port, err)
		}
	}

	return nil, fmt.Errorf("no loopback port available in recovery range %d-%d", config.RecoveryStart, config.RecoveryEnd)
}

func listenOn(port int) (net.Listener, error) {
	return net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}

func validateConfig(config ListenerConfig) error {
	if config.PreferredPort < 1 || config.PreferredPort > 65535 {
		return fmt.Errorf("preferred port %d is outside 1-65535", config.PreferredPort)
	}
	if config.RecoveryStart < 1 || config.RecoveryEnd > 65535 || config.RecoveryStart > config.RecoveryEnd {
		return fmt.Errorf("invalid recovery range %d-%d", config.RecoveryStart, config.RecoveryEnd)
	}
	return nil
}
