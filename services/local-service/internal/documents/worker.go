package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"path"
	"runtime/debug"
	"strings"
	"time"
)

// ProcessParser isolates the PDF decoder from the process holding history and keys.
// Text files use the bounded UTF-8 parser directly.
func ProcessParser(executable string) Parser {
	slots := make(chan struct{}, 2)
	return func(ctx context.Context, input Input) (Prepared, error) {
		if !strings.EqualFold(path.Ext(strings.TrimSpace(input.Name)), ".pdf") {
			return Parse(ctx, input)
		}
		if len(input.Data) == 0 || len(input.Data) > MaxFileBytes {
			return Prepared{}, invalid("Each file must contain between 1 byte and 4 MiB.")
		}
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		case <-ctx.Done():
			return Prepared{}, invalid("PDF parsing was cancelled.")
		}
		encoded, err := json.Marshal(input)
		if err != nil {
			return Prepared{}, err
		}
		command := exec.CommandContext(ctx, executable, "--extract-pdf")
		command.WaitDelay = 250 * time.Millisecond
		command.Env = []string{}
		command.Stdin = bytes.NewReader(encoded)
		var output boundedOutput
		command.Stdout = &output
		command.Stderr = io.Discard
		if err := command.Run(); err != nil {
			if ctx.Err() != nil {
				return Prepared{}, invalid("PDF parsing timed out or was cancelled. Try a smaller file.")
			}
			return Prepared{}, invalid("The PDF could not be read. Use a text-based PDF with at most 50 pages and 60,000 extracted characters; scanned or password-protected files are unsupported.")
		}
		var snapshot Snapshot
		if err := json.Unmarshal(output.Bytes(), &snapshot); err != nil {
			return Prepared{}, invalid("The PDF text could not be extracted.")
		}
		return Prepared{Snapshot: snapshot, Data: append([]byte(nil), input.Data...)}, nil
	}
}

type boundedOutput struct{ bytes.Buffer }

func (output *boundedOutput) Write(data []byte) (int, error) {
	if output.Len()+len(data) > 1<<20 {
		return 0, invalid("PDF parser output is too large.")
	}
	return output.Buffer.Write(data)
}

// RunWorker runs before normal service initialization, without opening local data
// or Keychain. The parent owns a hard deadline; these limits reduce decoder memory
// and recursive-stack pressure but are not an operating-system sandbox.
func RunWorker(input io.Reader, output io.Writer) error {
	debug.SetMemoryLimit(128 << 20)
	debug.SetMaxStack(1 << 20)
	var file Input
	if err := json.NewDecoder(io.LimitReader(input, 6<<20)).Decode(&file); err != nil {
		return invalid("Invalid PDF input.")
	}
	if !strings.EqualFold(path.Ext(file.Name), ".pdf") {
		return invalid("A PDF file is required.")
	}
	prepared, err := Parse(context.Background(), file)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(prepared.Snapshot)
}
