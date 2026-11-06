// Package localsecurity owns browser authorization for the loopback Local Service.
package localsecurity

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	LaunchTokenTTL     = 45 * time.Second
	SessionIdleTTL     = 30 * time.Minute
	SessionAbsoluteTTL = 12 * time.Hour
)

var (
	ErrInvalidLaunchToken = errors.New("invalid launch token")
	ErrInvalidSession     = errors.New("invalid browser session")
)

type Clock func() time.Time

type TokenSource func() (string, error)

type Session struct {
	ID        string
	CSRFToken string
	CreatedAt time.Time
	LastSeen  time.Time
}

type launchToken struct {
	issuedAt time.Time
}

type Manager struct {
	clock       Clock
	tokenSource TokenSource

	mu           sync.Mutex
	launchTokens map[string]launchToken
	sessions     map[string]Session
}

func New(clock Clock, tokenSource TokenSource) *Manager {
	if clock == nil {
		clock = time.Now
	}
	if tokenSource == nil {
		tokenSource = secureToken
	}
	return &Manager{
		clock:        clock,
		tokenSource:  tokenSource,
		launchTokens: make(map[string]launchToken),
		sessions:     make(map[string]Session),
	}
}

func (manager *Manager) MintLaunchToken() (string, error) {
	token, err := manager.tokenSource()
	if err != nil {
		return "", err
	}
	manager.RegisterLaunchToken(token)
	return token, nil
}

func (manager *Manager) RegisterLaunchToken(token string) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.launchTokens[token] = launchToken{issuedAt: manager.clock()}
}

func (manager *Manager) ConsumeLaunchToken(token string) (Session, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	launch, ok := manager.launchTokens[token]
	if !ok || manager.clock().Sub(launch.issuedAt) > LaunchTokenTTL {
		delete(manager.launchTokens, token)
		return Session{}, ErrInvalidLaunchToken
	}
	delete(manager.launchTokens, token)

	id, err := manager.tokenSource()
	if err != nil {
		return Session{}, err
	}
	csrfToken, err := manager.tokenSource()
	if err != nil {
		return Session{}, err
	}
	now := manager.clock()
	session := Session{
		ID:        id,
		CSRFToken: csrfToken,
		CreatedAt: now,
		LastSeen:  now,
	}
	manager.sessions[session.ID] = session
	return session, nil
}

func (manager *Manager) Session(id string) (Session, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	session, ok := manager.sessions[id]
	if !ok || manager.sessionExpired(session) {
		delete(manager.sessions, id)
		return Session{}, ErrInvalidSession
	}
	session.LastSeen = manager.clock()
	manager.sessions[id] = session
	return session, nil
}

func (manager *Manager) InvalidateSessions() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.sessions = make(map[string]Session)
}

func (manager *Manager) sessionExpired(session Session) bool {
	now := manager.clock()
	return now.Sub(session.LastSeen) > SessionIdleTTL || now.Sub(session.CreatedAt) > SessionAbsoluteTTL
}

func secureToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("read random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
