package documents

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestTextSnapshotsPreserveUnicodeAndSourceLines(t *testing.T) {
	input := Input{Name: "notes.md", Data: []byte("\ufeffFirst\r\n\u4e2d\u6587\rThird")}
	parsed, err := Parse(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.ID) != 64 || len(parsed.Sections) != 3 || parsed.Sections[1].Text != "\u4e2d\u6587" || parsed.Sections[2].ID != "L3" {
		t.Fatalf("unexpected source mapping: %#v", parsed.Snapshot)
	}
	input.Data[0] = 'X'
	if parsed.Data[0] == 'X' {
		t.Fatal("original file bytes were not copied")
	}
	if !strings.Contains(Prompt("Summarize", []Prepared{parsed}), `"id":"L2"`) {
		t.Fatal("source line missing from prompt")
	}
}

func TestDocumentValidationAndBounds(t *testing.T) {
	for _, input := range []Input{
		{Name: "../notes.txt", Data: []byte("data")},
		{Name: "notes.exe", Data: []byte("data")},
		{Name: "notes.txt", Data: []byte{0, 1, 2}},
		{Name: "notes.txt", Data: []byte{0xff}},
		{Name: "notes.txt", Data: []byte(" \n")},
		{Name: "notes.txt", Data: make([]byte, MaxFileBytes+1)},
		{Name: "notes.txt", Data: []byte(strings.Repeat("a", MaxTextCharacters+1))},
		{Name: "notes.txt", Data: []byte(strings.Repeat("\n", 4001) + "a")},
		{Name: "broken.pdf", Data: []byte("%PDF-1.4 broken")},
	} {
		if _, err := Parse(context.Background(), input); !errors.Is(err, ErrInvalidDocument) {
			t.Errorf("%s: expected validation error, got %v", input.Name, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Parse(ctx, Input{Name: "notes.txt", Data: []byte("data")}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	one := Input{Name: "one.txt", Data: []byte("data")}
	if _, err := Prepare(context.Background(), []Input{one, one}); !errors.Is(err, ErrInvalidDocument) {
		t.Fatal("duplicate content was accepted")
	}
	if _, err := Prepare(context.Background(), make([]Input, 5)); !errors.Is(err, ErrInvalidDocument) {
		t.Fatal("too many files were accepted")
	}
	if _, err := Prepare(context.Background(), []Input{{Name: "a.txt", Data: []byte(strings.Repeat("a", 60000))}, {Name: "b.txt", Data: []byte(strings.Repeat("b", 60000))}, {Name: "c.txt", Data: []byte("c")}}); !errors.Is(err, ErrInvalidDocument) {
		t.Fatal("combined source limit was not enforced")
	}
}

func TestPDFExtractionPreservesPageNumbersAndRejectsScannedPages(t *testing.T) {
	for _, withText := range []bool{true, false} {
		parsed, err := Parse(context.Background(), Input{Name: "fixture.pdf", Data: makePDF(withText)})
		if !withText {
			if !errors.Is(err, ErrInvalidDocument) {
				t.Fatalf("image-only PDF: %v", err)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if parsed.MediaType != "application/pdf" || len(parsed.Sections) != 1 || parsed.Sections[0].ID != "P1" || !strings.Contains(parsed.Sections[0].Text, "Synthetic source") {
			t.Fatalf("PDF source mapping: %#v", parsed.Snapshot)
		}
	}
}

// makePDF constructs a synthetic, self-contained PDF with correct xref offsets.
func makePDF(withText bool) []byte {
	stream := ""
	if withText {
		stream = "BT /F1 12 Tf 72 720 Td (Synthetic source) Tj ET\n"
	}
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream)}
	var text strings.Builder
	text.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for index, object := range objects {
		offsets = append(offsets, text.Len())
		fmt.Fprintf(&text, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}
	xref := text.Len()
	fmt.Fprintf(&text, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&text, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&text, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return []byte(text.String())
}
