package main

import (
	"io"
	"testing"
)

func TestGenericAuthorKit(t *testing.T) {
	for _, args := range [][]string{
		{"test", "starter.coveapp", "starter-scenario.json"},
		{"test", "starter-v1.1.coveapp", "starter-scenario.json"},
		{"upgrade-test", "starter.coveapp", "starter-v1.1.coveapp", "starter-upgrade.json"},
	} {
		if err := run(args, io.Discard); err != nil {
			t.Fatal(args[0], err)
		}
	}
}
