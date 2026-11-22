//go:build darwin || linux

package localmodels

import (
	"os"
	"runtime"
	"syscall"
)

func peakResidentBytes(state *os.ProcessState) int64 {
	if state == nil {
		return 0
	}
	usage, ok := state.SysUsage().(*syscall.Rusage)
	if !ok {
		return 0
	}
	value := usage.Maxrss
	if runtime.GOOS == "linux" {
		value *= 1024
	}
	return value
}
