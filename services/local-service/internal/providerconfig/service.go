package providerconfig

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

var (
	ErrValidationFailed = errors.New("provider connection validation failed")
	ErrUnconfigured     = errors.New("provider is unconfigured")
)

type ProfileInput = provider.ProfileInput
type Profile = provider.Profile
type ValidationResult = provider.ValidationResult
type ModelMetadata = provider.ModelMetadata

type Service struct {
	profiles persistence.ProviderStore
	secrets  credentials.SecretStore
	adapter  *provider.HTTPAdapter
}

func NewService(profiles persistence.ProviderStore, secrets credentials.SecretStore, client *http.Client) *Service {
	return &Service{profiles: profiles, secrets: secrets, adapter: provider.NewHTTPAdapter(client)}
}

func (service *Service) List(ctx context.Context) ([]Profile, error) {
	stored, err := service.profiles.ListProviderProfiles(ctx)
	if err != nil {
		return nil, err
	}
	profiles := make([]Profile, 0, len(stored))
	for _, saved := range stored {
		profile, err := fromStored(saved)
		if err != nil {
			return nil, err
		}
		profile.Configured = service.hasSecret(ctx, profile.ID)
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func (service *Service) Get(ctx context.Context, id string) (Profile, error) {
	saved, err := service.profiles.GetProviderProfile(ctx, id)
	if err != nil {
		return Profile{}, err
	}
	profile, err := fromStored(saved)
	if err != nil {
		return Profile{}, err
	}
	profile.Configured = service.hasSecret(ctx, profile.ID)
	return profile, nil
}

// Resolve returns the normalized profile and its secret to the chat module.
func (service *Service) Resolve(ctx context.Context, id string) (provider.Profile, credentials.Secret, error) {
	profile, err := service.Get(ctx, id)
	if err != nil {
		return provider.Profile{}, credentials.Secret{}, err
	}
	secret, err := service.secrets.Get(ctx, profile.ID)
	if errors.Is(err, credentials.ErrSecretNotFound) || errors.Is(err, credentials.ErrInvalidSecret) {
		return provider.Profile{}, credentials.Secret{}, ErrUnconfigured
	}
	if err != nil {
		return provider.Profile{}, credentials.Secret{}, err
	}
	return profile, secret, nil
}

func (service *Service) Validate(ctx context.Context, input ProfileInput) (ValidationResult, error) {
	profile, err := service.profileForValidation(ctx, input)
	if err != nil {
		return ValidationResult{}, err
	}
	secret := credentials.Secret{Value: input.Secret}
	if secret.Value == "" {
		secret, err = service.secrets.Get(ctx, profile.ID)
		if errors.Is(err, credentials.ErrSecretNotFound) || errors.Is(err, credentials.ErrInvalidSecret) {
			return ValidationResult{}, ErrUnconfigured
		}
		if err != nil {
			return ValidationResult{}, err
		}
	}
	result, err := service.adapter.Validate(ctx, provider.ValidateInput{Profile: profile, Secret: secret})
	if err != nil {
		return ValidationResult{}, fmt.Errorf("%w: %w", ErrValidationFailed, err)
	}
	return result, nil
}

func (service *Service) Discover(ctx context.Context, input ProfileInput) (ValidationResult, error) {
	profile, err := service.profileForValidation(ctx, input)
	if err != nil {
		return ValidationResult{}, err
	}
	secret := credentials.Secret{Value: input.Secret}
	if secret.Value == "" {
		secret, err = service.secrets.Get(ctx, profile.ID)
		if errors.Is(err, credentials.ErrSecretNotFound) || errors.Is(err, credentials.ErrInvalidSecret) {
			return ValidationResult{}, ErrUnconfigured
		}
		if err != nil {
			return ValidationResult{}, err
		}
	}
	metadata, err := service.adapter.ListModelMetadata(ctx, profile, secret)
	if err != nil {
		return ValidationResult{}, fmt.Errorf("%w: %w", ErrValidationFailed, err)
	}
	models := make([]string, 0, len(metadata))
	for _, model := range metadata {
		models = append(models, model.ID)
	}
	return ValidationResult{Models: models, ModelMetadata: metadata}, nil
}

// ModelMetadata returns the provider's current classification for a selected
// model. The chat service uses this server-side result to decide whether it is
// safe to send plaintext to the ordinary transport or must wait for browser
// attestation/E2EE.
func (service *Service) ModelMetadata(ctx context.Context, providerID, modelID string) (ModelMetadata, error) {
	profile, secret, err := service.Resolve(ctx, providerID)
	if err != nil {
		return ModelMetadata{}, err
	}
	metadata, err := service.adapter.ListModelMetadata(ctx, profile, secret)
	if err != nil {
		return ModelMetadata{}, fmt.Errorf("read provider model metadata: %w", err)
	}
	for _, model := range metadata {
		if model.ID == modelID {
			return model, nil
		}
	}
	return ModelMetadata{}, provider.ErrModelUnavailable
}

// ValidateSelection verifies that a persisted active selection still belongs
// to a configured Provider and its current model catalog.
func (service *Service) ValidateSelection(ctx context.Context, providerID, modelID string) error {
	if strings.TrimSpace(providerID) == "" || strings.TrimSpace(modelID) == "" {
		return provider.ErrModelUnavailable
	}
	profile, secret, err := service.Resolve(ctx, providerID)
	if err != nil {
		return err
	}
	models, err := service.adapter.ListModels(ctx, profile, secret)
	if err != nil {
		return fmt.Errorf("validate provider selection: %w", err)
	}
	for _, model := range models {
		if model == modelID {
			return nil
		}
	}
	return provider.ErrModelUnavailable
}

func (service *Service) Configure(ctx context.Context, input ProfileInput) (Profile, error) {
	profile, err := service.profileForConfiguration(ctx, input)
	if err != nil {
		return Profile{}, err
	}
	if input.Secret != "" {
		result, err := service.adapter.Validate(ctx, provider.ValidateInput{
			Profile: profile,
			Secret:  credentials.Secret{Value: input.Secret},
		})
		if err != nil {
			return Profile{}, fmt.Errorf("%w: %w", ErrValidationFailed, err)
		}
		_ = result
		old, err := service.secrets.Get(ctx, profile.ID)
		if errors.Is(err, credentials.ErrSecretNotFound) {
			old = credentials.Secret{}
		} else if errors.Is(err, credentials.ErrInvalidSecret) {
			old = credentials.Secret{}
		} else if err != nil {
			return Profile{}, err
		}
		if err := service.secrets.ReplaceAfterValidation(ctx, profile.ID, old.Version, credentials.Secret{Value: input.Secret}); err != nil {
			return Profile{}, err
		}
	}
	if err := service.profiles.UpsertProviderProfile(ctx, toStored(profile)); err != nil {
		return Profile{}, err
	}
	saved, err := service.Get(ctx, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	return saved, nil
}

func (service *Service) Delete(ctx context.Context, id string) error {
	if _, err := service.profiles.GetProviderProfile(ctx, id); err != nil {
		return err
	}
	if err := service.secrets.Delete(ctx, id); err != nil {
		return err
	}
	return service.profiles.DeleteProviderProfile(ctx, id)
}

func (service *Service) DeleteKey(ctx context.Context, id string) error {
	if _, err := service.profiles.GetProviderProfile(ctx, id); err != nil {
		return err
	}
	return service.secrets.Delete(ctx, id)
}

func (service *Service) profileForConfiguration(ctx context.Context, input ProfileInput) (Profile, error) {
	profile, err := provider.NewProfile(input)
	if err != nil {
		return Profile{}, err
	}
	if profile.ID == "" {
		profile.ID, err = newID()
		if err != nil {
			return Profile{}, fmt.Errorf("create provider profile ID: %w", err)
		}
	}
	if input.ID != "" {
		if saved, getErr := service.profiles.GetProviderProfile(ctx, profile.ID); getErr == nil {
			if saved.Kind != profile.Kind {
				return Profile{}, provider.ErrInvalidProfile
			}
			profile.CreatedAt = saved.CreatedAt
		}
	}
	return profile, nil
}

func (service *Service) profileForValidation(ctx context.Context, input ProfileInput) (Profile, error) {
	if input.ID != "" {
		stored, err := service.Get(ctx, input.ID)
		if err != nil {
			return Profile{}, err
		}
		if input.Kind == "" && input.Endpoint == "" && input.AuthMethod == "" && input.Model == "" {
			return stored, nil
		}
		draft, err := provider.NewProfile(input)
		if err != nil {
			return Profile{}, err
		}
		draft.ID = stored.ID
		draft.CreatedAt = stored.CreatedAt
		return draft, nil
	}
	profile, err := provider.NewProfile(input)
	if err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func (service *Service) hasSecret(ctx context.Context, id string) bool {
	exists, err := service.secrets.Exists(ctx, id)
	return err == nil && exists
}

func fromStored(saved persistence.ProviderProfile) (Profile, error) {
	profile, err := provider.NormalizeProfile(Profile{
		ID:         saved.ID,
		Kind:       saved.Kind,
		Name:       saved.Name,
		Endpoint:   saved.Endpoint,
		Model:      saved.ModelID,
		AuthMethod: saved.AuthMethod,
	})
	if err != nil {
		return Profile{}, err
	}
	profile.CreatedAt = saved.CreatedAt
	profile.UpdatedAt = saved.UpdatedAt
	return profile, nil
}

func toStored(profile Profile) persistence.ProviderProfile {
	return persistence.ProviderProfile{
		ID:         profile.ID,
		Kind:       profile.Kind,
		Name:       profile.Name,
		Endpoint:   profile.Endpoint,
		ModelID:    profile.Model,
		AuthMethod: profile.AuthMethod,
		CreatedAt:  profile.CreatedAt,
		UpdatedAt:  profile.UpdatedAt,
	}
}

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
