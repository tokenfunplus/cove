package providerconfig

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
)

var (
	ErrValidationFailed   = errors.New("provider connection validation failed")
	ErrUnconfigured       = errors.New("provider is unconfigured")
	ErrDestinationChanged = errors.New("enter a Provider Key for the changed connection")
)

type ProfileInput = provider.ProfileInput
type Profile = provider.Profile
type ValidationResult = provider.ValidationResult
type ModelMetadata = provider.ModelMetadata

type Service struct {
	local    LocalProvider
	profiles persistence.ProviderStore
	secrets  credentials.SecretStore
	adapter  *provider.HTTPAdapter
	writeMu  sync.Mutex
}

type LocalProvider interface {
	Profile() provider.Profile
	Metadata() []provider.ModelMetadata
}

func (service *Service) SetLocalProvider(local LocalProvider) { service.local = local }

const localProviderID = "cove-local"

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
		profile.Configured = service.hasSecret(ctx, saved)
		profiles = append(profiles, profile)
	}
	if service.local != nil {
		profiles = append(profiles, service.local.Profile())
	}
	return profiles, nil
}

func (service *Service) Get(ctx context.Context, id string) (Profile, error) {
	if id == localProviderID && service.local != nil {
		return service.local.Profile(), nil
	}
	saved, err := service.profiles.GetProviderProfile(ctx, id)
	if err != nil {
		return Profile{}, err
	}
	profile, err := fromStored(saved)
	if err != nil {
		return Profile{}, err
	}
	profile.Configured = service.hasSecret(ctx, saved)
	return profile, nil
}

// Resolve reads the destination and its credential reference from the same row.
func (service *Service) Resolve(ctx context.Context, id string) (Profile, credentials.Secret, error) {
	if id == localProviderID && service.local != nil {
		profile := service.local.Profile()
		if !profile.Configured {
			return Profile{}, credentials.Secret{}, ErrUnconfigured
		}
		return profile, credentials.Secret{}, nil
	}
	saved, err := service.profiles.GetProviderProfile(ctx, id)
	if err != nil {
		return Profile{}, credentials.Secret{}, err
	}
	profile, err := fromStored(saved)
	if err != nil {
		return Profile{}, credentials.Secret{}, err
	}
	secret, err := service.readSecret(ctx, saved)
	profile.Configured = err == nil
	return profile, secret, err
}

// ResolveCatalog retrieves one current catalog for a resolved connection.
func (service *Service) ResolveCatalog(ctx context.Context, id string) (Profile, credentials.Secret, []ModelMetadata, error) {
	if id == localProviderID && service.local != nil {
		profile, secret, err := service.Resolve(ctx, id)
		return profile, secret, service.local.Metadata(), err
	}
	profile, secret, err := service.Resolve(ctx, id)
	if err != nil {
		return Profile{}, credentials.Secret{}, nil, err
	}
	metadata, err := service.adapter.ListModelMetadata(ctx, profile, secret)
	return profile, secret, metadata, err
}

func (service *Service) Validate(ctx context.Context, input ProfileInput) (ValidationResult, error) {
	if input.ID == localProviderID && service.local != nil {
		return service.Discover(ctx, input)
	}
	profile, secret, err := service.validationConnection(ctx, input)
	if err != nil {
		return ValidationResult{}, err
	}
	result, err := service.adapter.Validate(ctx, provider.ValidateInput{Profile: profile, Secret: secret})
	if err != nil {
		return ValidationResult{}, fmt.Errorf("%w: %w", ErrValidationFailed, err)
	}
	return result, nil
}

func (service *Service) Discover(ctx context.Context, input ProfileInput) (ValidationResult, error) {
	if input.ID == localProviderID && service.local != nil {
		_, _, metadata, err := service.ResolveCatalog(ctx, input.ID)
		ids := make([]string, len(metadata))
		for i, m := range metadata {
			ids[i] = m.ID
		}
		return ValidationResult{Models: ids, ModelMetadata: metadata}, err
	}
	profile, secret, err := service.validationConnection(ctx, input)
	if err != nil {
		return ValidationResult{}, err
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
	_, _, metadata, err := service.ResolveCatalog(ctx, providerID)
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
	_, err := service.ModelMetadata(ctx, providerID, modelID)
	return err
}

const noCredential = "-"
const credentialPrefix = "cove-credential/"

func (service *Service) Configure(ctx context.Context, input ProfileInput) (Profile, error) {
	if input.ID == localProviderID || input.Kind == provider.KindLocal {
		return Profile{}, provider.ErrInvalidProfile
	}
	profile, err := provider.NewProfile(input)
	if err != nil {
		return Profile{}, err
	}
	if profile.ID == "" {
		profile.ID, err = newID()
		if err != nil {
			return Profile{}, fmt.Errorf("create provider profile ID: %w", err)
		}
	} else if strings.HasPrefix(profile.ID, credentialPrefix) {
		return Profile{}, provider.ErrInvalidProfile
	}

	saved, err := service.profiles.GetProviderProfile(ctx, profile.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Profile{}, err
	}
	next := toStored(profile)
	next.CredentialRef = noCredential
	if err == nil {
		prior, err := fromStored(saved)
		if err != nil {
			return Profile{}, err
		}
		if prior.Kind != profile.Kind {
			return Profile{}, provider.ErrInvalidProfile
		}
		next.CreatedAt = saved.CreatedAt
		if sameDestination(prior, profile) {
			next.CredentialRef = saved.CredentialRef
		} else if input.Secret == "" && saved.CredentialRef != noCredential {
			exists, err := service.secrets.Exists(ctx, credentialRef(saved))
			if err != nil {
				return Profile{}, err
			}
			if exists {
				return Profile{}, ErrDestinationChanged
			}
		}
	}
	if input.Secret != "" {
		secret := credentials.Secret{Value: input.Secret}
		if _, err := service.adapter.Validate(ctx, provider.ValidateInput{Profile: profile, Secret: secret}); err != nil {
			return Profile{}, fmt.Errorf("%w: %w", ErrValidationFailed, err)
		}
		id, err := newID()
		if err != nil {
			return Profile{}, fmt.Errorf("create Provider Key reference: %w", err)
		}
		next.CredentialRef = credentialPrefix + id
		if err := service.secrets.ReplaceAfterValidation(ctx, next.CredentialRef, 0, secret); err != nil {
			return Profile{}, err
		}
	}
	service.writeMu.Lock()
	defer service.writeMu.Unlock()
	if err := service.profiles.UpsertProviderProfile(ctx, next, saved.UpdatedAt); err != nil {
		if input.Secret != "" {
			service.discardUnpublishedCredential(ctx, next)
		}
		return Profile{}, err
	}
	if saved.ID != "" && next.CredentialRef != saved.CredentialRef {
		service.discardCredential(ctx, saved)
	}
	return service.Get(ctx, profile.ID)
}

func (service *Service) Delete(ctx context.Context, id string) error {
	service.writeMu.Lock()
	defer service.writeMu.Unlock()
	saved, err := service.profiles.GetProviderProfile(ctx, id)
	if err != nil {
		return err
	}
	if err := service.deleteCredential(ctx, saved); err != nil {
		return err
	}
	return service.profiles.DeleteProviderProfile(ctx, id, saved.UpdatedAt)
}

func (service *Service) DeleteKey(ctx context.Context, id string) error {
	service.writeMu.Lock()
	defer service.writeMu.Unlock()
	saved, err := service.profiles.GetProviderProfile(ctx, id)
	if err != nil {
		return err
	}
	if saved.CredentialRef == noCredential {
		return nil
	}
	if err := service.deleteCredential(ctx, saved); err != nil {
		return err
	}
	next := saved
	next.CredentialRef = noCredential
	return service.profiles.UpsertProviderProfile(ctx, next, saved.UpdatedAt)
}

func (service *Service) deleteCredential(ctx context.Context, saved persistence.ProviderProfile) error {
	if saved.CredentialRef == noCredential {
		return nil
	}
	err := service.secrets.Delete(ctx, credentialRef(saved))
	if errors.Is(err, credentials.ErrSecretNotFound) {
		return nil
	}
	return err
}

func (service *Service) CheckResolvedProfile(ctx context.Context, profile Profile) error {
	if profile.ID == localProviderID && service.local != nil {
		if !service.local.Profile().Configured {
			return ErrUnconfigured
		}
		return nil
	}
	current, err := service.profiles.GetProviderProfile(ctx, profile.ID)
	if err != nil {
		return err
	}
	if !current.UpdatedAt.Equal(profile.UpdatedAt) {
		return persistence.ErrProviderProfileChanged
	}
	return nil
}

func (service *Service) validationConnection(ctx context.Context, input ProfileInput) (Profile, credentials.Secret, error) {
	var saved persistence.ProviderProfile
	var prior Profile
	if input.ID != "" {
		var err error
		saved, err = service.profiles.GetProviderProfile(ctx, input.ID)
		if err != nil {
			return Profile{}, credentials.Secret{}, err
		}
		prior, err = fromStored(saved)
		if err != nil {
			return Profile{}, credentials.Secret{}, err
		}
	}
	profile := prior
	if saved.ID == "" || input.Kind != "" || input.Endpoint != "" || input.AuthMethod != "" || input.Model != "" {
		var err error
		profile, err = provider.NewProfile(input)
		if err != nil {
			return Profile{}, credentials.Secret{}, err
		}
		if saved.ID != "" && prior.Kind != profile.Kind {
			return Profile{}, credentials.Secret{}, provider.ErrInvalidProfile
		}
	}
	if input.Secret != "" {
		return profile, credentials.Secret{Value: input.Secret}, nil
	}
	if saved.ID == "" {
		return Profile{}, credentials.Secret{}, ErrUnconfigured
	}
	if !sameDestination(prior, profile) {
		return Profile{}, credentials.Secret{}, ErrDestinationChanged
	}
	secret, err := service.readSecret(ctx, saved)
	return profile, secret, err
}

func sameDestination(left, right Profile) bool {
	return left.Kind == right.Kind && left.Endpoint == right.Endpoint && left.AuthMethod == right.AuthMethod
}

func credentialRef(saved persistence.ProviderProfile) string {
	if saved.CredentialRef == "" {
		return saved.ID // Legacy Keychain accounts were keyed by Provider ID.
	}
	return saved.CredentialRef
}

func (service *Service) readSecret(ctx context.Context, saved persistence.ProviderProfile) (credentials.Secret, error) {
	if saved.CredentialRef == noCredential {
		return credentials.Secret{}, ErrUnconfigured
	}
	secret, err := service.secrets.Get(ctx, credentialRef(saved))
	if errors.Is(err, credentials.ErrSecretNotFound) || errors.Is(err, credentials.ErrInvalidSecret) {
		return credentials.Secret{}, ErrUnconfigured
	}
	return secret, err
}

func (service *Service) hasSecret(ctx context.Context, saved persistence.ProviderProfile) bool {
	if saved.CredentialRef == noCredential {
		return false
	}
	exists, err := service.secrets.Exists(ctx, credentialRef(saved))
	return err == nil && exists
}

func (service *Service) discardUnpublishedCredential(ctx context.Context, next persistence.ProviderProfile) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	saved, err := service.profiles.GetProviderProfile(cleanup, next.ID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && saved.CredentialRef != next.CredentialRef) {
		_ = service.secrets.Delete(cleanup, next.CredentialRef)
	}
}

func (service *Service) discardCredential(ctx context.Context, saved persistence.ProviderProfile) {
	if saved.CredentialRef != noCredential {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = service.secrets.Delete(cleanup, credentialRef(saved))
	}
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
