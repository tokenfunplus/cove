//go:build !darwin && !linux

package localmodels

import "os"

func peakResidentBytes(*os.ProcessState) int64 { return 0 }
