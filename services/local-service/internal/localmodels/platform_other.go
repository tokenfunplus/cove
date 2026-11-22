//go:build !darwin

package localmodels

// Portable service tests can use an explicitly configured native runtime.
func platformSupported() bool { return true }
