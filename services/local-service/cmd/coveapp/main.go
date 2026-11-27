// Command coveapp develops and exercises packages using the Cove installer and runtime.
package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/tokenfunplus/cove/services/local-service/internal/appcatalog"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
)

//go:embed starter.coveapp
var starter []byte

const usage = `Usage:
  coveapp init PUBLISHER APP OUTPUT.json
  coveapp validate SOURCE
  coveapp preview SOURCE [--browser [--fixture SCENARIO.json] [--allow blobs.import] [--model-endpoint LOOPBACK_URL]]
  coveapp upgrade-test OLD NEW FIXTURE.json
  coveapp test SOURCE SCENARIO.json
  coveapp pack SOURCE OUTPUT.coveapp`

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		_, err := fmt.Fprintln(out, usage)
		return err
	}
	switch args[0] {
	case "init":
		if len(args) != 4 {
			return errors.New(usage)
		}
		var pkg miniapps.Package
		if err := json.Unmarshal(starter, &pkg); err != nil {
			return err
		}
		pkg.Publisher, pkg.App = args[1], args[2]
		if appcatalog.ReservedPublisher(pkg.Publisher) {
			return errors.New("choose your own publisher; this publisher is reserved for bundled releases")
		}
		source, err := json.MarshalIndent(pkg, "", "  ")
		if err != nil {
			return err
		}
		return writePackage(args[3], append(source, '\n'))
	case "upgrade-test":
		if len(args) != 4 {
			return errors.New(usage)
		}
		return upgradeTest(args[1], args[2], args[3], out)
	case "preview":
		if len(args) >= 3 && args[2] == "--browser" {
			return browserCommand(args[1], args[3:], out)
		}
		if len(args) != 2 {
			return errors.New(usage)
		}
	case "validate", "test", "pack":
		want := 2
		if args[0] == "test" || args[0] == "pack" {
			want = 3
		}
		if len(args) != want {
			return errors.New(usage)
		}
	default:
		return errors.New(usage)
	}
	source, err := readBounded(args[1])
	if err != nil {
		return err
	}
	pkg, err := miniapps.Validate(source)
	if err != nil {
		return err
	}
	switch args[0] {
	case "validate":
		_, err = fmt.Fprintf(out, "%s/%s %s is valid\n", pkg.Publisher, pkg.App, pkg.Version)
	case "pack":
		err = writePackage(args[2], source)
	case "preview":
		err = preview(source, out)
	case "test":
		err = runScenario(source, args[2], out)
	}
	return err
}

func readBounded(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	const maxBytes = 2 << 20
	b, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
	if len(b) > maxBytes {
		return nil, errors.New("input exceeds 2 MiB")
	}
	return b, err
}

func writePackage(path string, source []byte) error {
	if _, err := miniapps.Validate(source); err != nil {
		return err
	}
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := io.Copy(output, bytes.NewReader(source))
	if err = errors.Join(writeErr, output.Close()); err != nil {
		os.Remove(path)
	}
	return err
}
