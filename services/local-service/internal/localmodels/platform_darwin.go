package localmodels

import (
	"strconv"
	"strings"
	"syscall"
)

func platformSupported() bool {
	version, err := syscall.Sysctl("kern.osproductversion")
	if err != nil {
		return false
	}
	parts := strings.Split(version, ".")
	major, _ := strconv.Atoi(parts[0])
	minor := 0
	if len(parts) > 1 {
		minor, _ = strconv.Atoi(parts[1])
	}
	return major > 13 || major == 13 && minor >= 3
}
