//go:build !darwin

package credentials

import "errors"

var errKeychainUnavailable = errors.New("macOS Keychain is unavailable on this platform")

type unsupportedKeychainBackend struct{}

func newKeychainBackend() keychainBackend {
	return unsupportedKeychainBackend{}
}

func (unsupportedKeychainBackend) Exists(string, string) (bool, error) {
	return false, errKeychainUnavailable
}

func (unsupportedKeychainBackend) Get(string, string) ([]byte, error) {
	return nil, errKeychainUnavailable
}

func (unsupportedKeychainBackend) Replace(string, string, []byte) error {
	return errKeychainUnavailable
}

func (unsupportedKeychainBackend) Delete(string, string) error {
	return errKeychainUnavailable
}
