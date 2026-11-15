package documents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"
)

func FuzzParseTextDocument(f *testing.F) {
	for _, seed := range [][]byte{
		[]byte("First\r\n\u4e2d\u6587\rThird\n"),
		[]byte("\ufeffSource\ttext"),
		[]byte("\ufeff\ufeffSource"),
		[]byte(" \t\n"),
		{0, 0xff, 0x80},
		[]byte(strings.Repeat("a", MaxTextCharacters)),
		[]byte(strings.Repeat("a", MaxTextCharacters+1)),
		[]byte("text" + strings.Repeat("\n", 3999)),
		[]byte("text" + strings.Repeat("\n", 4000)),
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 128<<10 {
			t.Skip()
		}
		input := Input{Name: "source.txt", Data: bytes.Clone(data)}
		parsed, err := Parse(context.Background(), input)
		if err != nil {
			if !errors.Is(err, ErrInvalidDocument) || !reflect.DeepEqual(parsed, Prepared{}) {
				t.Fatal("invalid input returned an unexpected error or partial snapshot")
			}
			return
		}
		if !bytes.Equal(parsed.Data, data) || parsed.Size != len(data) || parsed.ID != fmt.Sprintf("%x", sha256.Sum256(data)) {
			t.Fatal("snapshot no longer identifies the original file bytes")
		}
		if parsed.Characters < 1 || parsed.Characters > MaxTextCharacters || len(parsed.Sections) < 1 || len(parsed.Sections) > 4000 {
			t.Fatal("accepted text exceeds extraction bounds")
		}
		lines := make([]string, len(parsed.Sections))
		for i, section := range parsed.Sections {
			if section.ID != fmt.Sprintf("L%d", i+1) || !utf8.ValidString(section.Text) || strings.ContainsAny(section.Text, "\r\n") {
				t.Fatal("source lines cannot be cited unambiguously")
			}
			if strings.IndexFunc(section.Text, func(r rune) bool { return unicode.IsControl(r) && r != '\t' }) >= 0 {
				t.Fatal("binary control character escaped text validation")
			}
			lines[i] = section.Text
		}
		canonical := strings.Join(lines, "\n")
		if utf8.RuneCountInString(canonical) != parsed.Characters {
			t.Fatal("character count differs from the cited source")
		}
		want := strings.TrimPrefix(string(data), "\ufeff")
		want = strings.ReplaceAll(strings.ReplaceAll(want, "\r\n", "\n"), "\r", "\n")
		if canonical != want {
			t.Fatal("source extraction changed text beyond BOM and line-ending normalization")
		}
		input.Data[0] ^= 0xff
		if !bytes.Equal(parsed.Data, data) {
			t.Fatal("snapshot aliases the caller's input buffer")
		}
	})
}
