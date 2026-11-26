package provider

import (
	"errors"
	"testing"
)

func TestValidateProfileEnforcesPresetAndLoopbackTransportPolicies(t *testing.T) {
	tests := []struct {
		name    string
		profile Profile
		wantErr error
	}{
		{
			name: "nearai uses its fixed endpoint",
			profile: Profile{
				Kind:       KindNearAIPreset,
				Endpoint:   "https://example.test",
				AuthMethod: AuthBearer,
			},
			wantErr: ErrInvalidEndpoint,
		},
		{
			name: "new NearAI presets reject the former staging endpoint",
			profile: Profile{
				Kind:       KindNearAIPreset,
				Endpoint:   "https://cloud-stg-api.near.ai",
				AuthMethod: AuthBearer,
			},
			wantErr: ErrInvalidEndpoint,
		},
		{
			name: "custom provider accepts https",
			profile: Profile{
				Kind:       KindOpenAICompatible,
				Endpoint:   "https://provider.example/v1",
				AuthMethod: AuthBearer,
			},
		},
		{
			name: "custom provider accepts loopback http",
			profile: Profile{
				Kind:       KindOpenAICompatible,
				Endpoint:   "http://127.0.0.1:11434",
				AuthMethod: AuthAPIKey,
			},
		},
		{
			name: "custom provider rejects public http",
			profile: Profile{
				Kind:       KindOpenAICompatible,
				Endpoint:   "http://provider.example",
				AuthMethod: AuthBearer,
			},
			wantErr: ErrInsecureEndpoint,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NormalizeProfile(test.profile)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("NormalizeProfile error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestNormalizeNearAIPresetUsesProductionEndpoint(t *testing.T) {
	profile, err := NormalizeProfile(Profile{
		Kind:       KindNearAIPreset,
		AuthMethod: AuthBearer,
	})
	if err != nil {
		t.Fatalf("NormalizeProfile error = %v", err)
	}
	if profile.Endpoint != "https://cloud-api.near.ai" {
		t.Fatalf("NearAI endpoint = %q, want production endpoint", profile.Endpoint)
	}
}
