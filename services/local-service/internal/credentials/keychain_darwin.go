//go:build darwin

package credentials

import (
	"errors"

	keychain "github.com/keybase/go-keychain"
)

type nativeKeychainBackend struct{}

func newKeychainBackend() keychainBackend {
	return nativeKeychainBackend{}
}

func (nativeKeychainBackend) Exists(service, account string) (bool, error) {
	query := keychain.NewItem()
	query.SetSecClass(keychain.SecClassGenericPassword)
	query.SetService(service)
	query.SetAccount(account)
	query.SetMatchLimit(keychain.MatchLimitOne)
	query.SetReturnAttributes(true)
	results, err := keychain.QueryItem(query)
	if err != nil {
		return false, err
	}
	return len(results) == 1, nil
}

func (nativeKeychainBackend) Get(service, account string) ([]byte, error) {
	value, err := keychain.GetGenericPassword(service, account, "", "")
	if err != nil {
		if errors.Is(err, keychain.ErrorItemNotFound) {
			return nil, ErrSecretNotFound
		}
		return nil, err
	}
	if len(value) == 0 {
		return nil, ErrSecretNotFound
	}
	return value, nil
}

func (nativeKeychainBackend) Replace(service, account string, value []byte) error {
	query := keychain.NewItem()
	query.SetSecClass(keychain.SecClassGenericPassword)
	query.SetService(service)
	query.SetAccount(account)

	update := keychain.NewItem()
	update.SetData(value)
	if err := keychain.UpdateItem(query, update); err == nil {
		return nil
	} else if !errors.Is(err, keychain.ErrorItemNotFound) {
		return err
	}

	item := keychain.NewGenericPassword(service, account, "", value, "")
	item.SetSynchronizable(keychain.SynchronizableNo)
	item.SetAccessible(keychain.AccessibleWhenUnlocked)
	return keychain.AddItem(item)
}

func (nativeKeychainBackend) Delete(service, account string) error {
	err := keychain.DeleteGenericPasswordItem(service, account)
	if errors.Is(err, keychain.ErrorItemNotFound) {
		return ErrSecretNotFound
	}
	return err
}
