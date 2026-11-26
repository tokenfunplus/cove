package provider

import (
	"errors"
	"net"
	"net/url"
	"strings"
	"time"
)

const (
	KindNearAIPreset     = "nearai"
	KindOpenAICompatible = "openai_compatible"
	KindLocal            = "local"

	AuthBearer = "bearer"
	AuthAPIKey = "x_api_key"
	AuthNone   = "none"

	NearAIEndpoint = "https://cloud-api.near.ai"
)

var (
	ErrInvalidProfile   = errors.New("provider profile is invalid")
	ErrInvalidEndpoint  = errors.New("provider endpoint is invalid")
	ErrInsecureEndpoint = errors.New("provider endpoint must use HTTPS or loopback HTTP")
	ErrInvalidAuth      = errors.New("provider authentication method is invalid")
)

type Profile struct {
	LocalModel        *ModelArtifact `json:"local_model,omitempty"`
	ID                string         `json:"id"`
	Kind              string         `json:"kind"`
	Name              string         `json:"name"`
	Endpoint          string         `json:"endpoint"`
	Model             string         `json:"model_id"`
	AuthMethod        string         `json:"auth_method"`
	RuntimeLocation   string         `json:"runtime_location"`
	Destination       string         `json:"destination"`
	TransportSecurity string         `json:"transport_security"`
	PrivacyNotice     string         `json:"privacy_notice"`
	Configured        bool           `json:"configured"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type ModelArtifact struct {
	Revision       string `json:"revision"`
	SHA256         string `json:"sha256"`
	RuntimeVersion string `json:"runtime_version"`
}

type ProfileInput struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Endpoint   string `json:"endpoint"`
	Model      string `json:"model_id"`
	AuthMethod string `json:"auth_method"`
	Secret     string `json:"secret,omitempty"`
}

func NormalizeProfile(profile Profile) (Profile, error) {
	profile.ID = strings.TrimSpace(profile.ID)
	profile.Kind = strings.TrimSpace(profile.Kind)
	profile.Name = strings.TrimSpace(profile.Name)
	profile.Endpoint = strings.TrimRight(strings.TrimSpace(profile.Endpoint), "/")
	profile.Model = strings.TrimSpace(profile.Model)
	profile.AuthMethod = strings.TrimSpace(profile.AuthMethod)

	switch profile.Kind {
	case KindLocal:
		if profile.ID != "cove-local" || profile.Endpoint != "http://127.0.0.1" || profile.AuthMethod != AuthBearer {
			return Profile{}, ErrInvalidProfile
		}
	case KindNearAIPreset:
		if profile.Endpoint == "" {
			profile.Endpoint = NearAIEndpoint
		}
		if profile.Endpoint != NearAIEndpoint {
			return Profile{}, ErrInvalidEndpoint
		}
		if profile.AuthMethod == "" {
			profile.AuthMethod = AuthBearer
		}
		if profile.AuthMethod != AuthBearer {
			return Profile{}, ErrInvalidAuth
		}
		if profile.ID == "" {
			profile.ID = KindNearAIPreset
		}
		if profile.Name == "" {
			profile.Name = "NearAI"
		}
	case KindOpenAICompatible:
		if profile.AuthMethod != AuthBearer && profile.AuthMethod != AuthAPIKey && profile.AuthMethod != AuthNone {
			return Profile{}, ErrInvalidAuth
		}
		if profile.Name == "" {
			profile.Name = "OpenAI-compatible Provider"
		}
	default:
		return Profile{}, ErrInvalidProfile
	}

	endpoint, err := validateEndpoint(profile.Endpoint, profile.Kind)
	if err != nil {
		return Profile{}, err
	}
	if profile.AuthMethod == AuthNone && !isLoopbackHost(endpoint.Hostname()) {
		return Profile{}, ErrInvalidAuth
	}
	profile.Endpoint = endpoint.String()
	profile.Destination = endpoint.Host
	profile.TransportSecurity = transportSecurity(endpoint)
	profile.RuntimeLocation = runtimeLocation(profile.Kind, endpoint)
	profile.PrivacyNotice = privacyNotice(profile)
	if profile.Kind == KindLocal {
		profile.RuntimeLocation = "On this Mac"
		profile.Destination = "Cove managed local inference"
		profile.PrivacyNotice = "This response is generated on this Mac using a bundled inference runtime. Conversation text is not sent to a remote model Provider. Explicit web tools still contact their sources."
	}
	return profile, nil
}

func NewProfile(input ProfileInput) (Profile, error) {
	profile, err := NormalizeProfile(Profile{
		ID:         input.ID,
		Kind:       input.Kind,
		Name:       input.Name,
		Endpoint:   input.Endpoint,
		Model:      input.Model,
		AuthMethod: input.AuthMethod,
	})
	if err == nil && profile.AuthMethod == AuthNone && input.Secret != "" {
		return Profile{}, ErrInvalidAuth
	}
	return profile, err
}

func validateEndpoint(raw, kind string) (*url.URL, error) {
	if raw == "" {
		return nil, ErrInvalidEndpoint
	}
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, ErrInvalidEndpoint
	}
	if kind == KindNearAIPreset && endpoint.String() != NearAIEndpoint {
		return nil, ErrInvalidEndpoint
	}
	switch endpoint.Scheme {
	case "https":
		return endpoint, nil
	case "http":
		if isLoopbackHost(endpoint.Hostname()) {
			return endpoint, nil
		}
		return nil, ErrInsecureEndpoint
	default:
		return nil, ErrInvalidEndpoint
	}
}

func isLoopbackHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func transportSecurity(endpoint *url.URL) string {
	if endpoint.Scheme == "https" {
		return "tls"
	}
	if endpoint.Scheme == "http" {
		return "plaintext"
	}
	return "unknown"
}

func runtimeLocation(kind string, endpoint *url.URL) string {
	if kind == KindNearAIPreset {
		return "NearAI cloud"
	}
	if isLoopbackHost(endpoint.Hostname()) {
		return "User local service"
	}
	return "User configured cloud provider"
}

func privacyNotice(profile Profile) string {
	if profile.Kind == KindNearAIPreset {
		return "Conversation content is sent to NearAI cloud over HTTPS/TLS. Cove does not store a cloud conversation."
	}
	if profile.TransportSecurity == "plaintext" {
		return "Conversation content is sent to the configured loopback Provider over local plaintext HTTP. Cove does not store a cloud conversation."
	}
	return "Conversation content is sent to the configured Provider over HTTPS/TLS. Cove does not store a cloud conversation."
}
