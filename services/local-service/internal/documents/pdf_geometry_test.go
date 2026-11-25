package documents

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/ledongthuc/pdf"
)

func TestPDFGlyphGeometryReusesPlainTextFont(t *testing.T) {
	const font = "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /ToUnicode 4 0 R >>"
	const cmap = "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n3 beginbfchar\n<0001> <4E2D>\n<0002> <6587>\n<0003> <6BB5>\nendbfchar\n"
	const content = "BT /F1 12 Tf 72 720 Td <0001> Tj ET\nBT /F1 12 Tf 84 720 Td <0002> Tj ET\nBT /F1 12 Tf 96 720 Td <0003> Tj ET\n"
	data := makePDFWithFontObjects([]string{font, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(cmap), cmap)}, content)
	cmapOffset := int64(bytes.Index(data, []byte(cmap)))
	cmapReads := 0
	reader := &pdfReadHook{Reader: bytes.NewReader(data), onRead: func(offset int64) {
		if offset == cmapOffset {
			cmapReads++
		}
	}}
	page := readPDFGeometryPage(t, reader, len(data))
	fonts := pdfPageFonts(page)
	plain, err := page.GetPlainText(fonts)
	if err != nil || cmapReads == 0 {
		t.Fatalf("plain text did not parse the CMap: %v, reads=%d", err, cmapReads)
	}
	before := cmapReads
	got := repairPDFGlyphLines(context.Background(), page, fonts, strings.TrimSpace(plain))
	if got != "\u4e2d\u6587\u6bb5" || cmapReads != before {
		t.Fatalf("cached geometry: %q, %d additional CMap reads", got, cmapReads-before)
	}
}

func TestPDFGlyphGeometryStopsDuringTraversal(t *testing.T) {
	const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
	const content = "BT /F1 12 Tf 72 720 Td (A) Tj ET\n"
	data := makePDFWithStreams(font, content)
	reader := &pdfReadHook{Reader: bytes.NewReader(data)}
	page := readPDFGeometryPage(t, reader, len(data))
	fonts := pdfPageFonts(page)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	contentOffset := int64(bytes.Index(data, []byte(content)))
	reader.onRead = func(offset int64) {
		if offset == contentOffset {
			cancel()
		}
	}
	if got := positionedPDFGlyphs(ctx, page, fonts, MaxTextCharacters); len(got) != 0 || !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("cancelled traversal returned %d glyphs with context error %v", len(got), ctx.Err())
	}
}

func TestPDFGlyphGeometryBoundsRetainedRecords(t *testing.T) {
	const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
	data := makePDFWithStreams(font, "BT /F1 12 Tf 72 720 Td (A ) Tj [(B) -10 (C)] TJ ET\n")
	page := readPDFGeometryPage(t, bytes.NewReader(data), len(data))
	fonts := pdfPageFonts(page)
	ctx := context.Background()
	if got := positionedPDFGlyphs(ctx, page, fonts, 4); len(got) != 4 || got[1].char != ' ' || got[3].char != 'C' {
		t.Fatalf("geometry within budget: %#v", got)
	}
	if got := positionedPDFGlyphs(ctx, page, fonts, 3); got != nil {
		t.Fatalf("over-budget traversal returned partial geometry: %#v", got)
	}
}

func TestPDFGlyphGeometryUsesWordSpacingWithPageScale(t *testing.T) {
	font := "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 66 /Widths [250 " + strings.Repeat("0 ", 32) + "600 600] >>"
	for _, show := range []string{`4 Tw (A B) Tj`, `4 0 (A B) "`} {
		data := makePDFWithStreams(font, "q 2 0 0 3 5 7 cm BT /F1 10 Tf 125 Tz 72 720 Td "+show+" ET Q\n")
		page := readPDFGeometryPage(t, bytes.NewReader(data), len(data))
		glyphs := positionedPDFGlyphs(context.Background(), page, pdfPageFonts(page), MaxTextCharacters)
		want := pdfGlyph{x: 180.25, y: 2167, width: 15, horizontalSize: 25, verticalSize: 30, char: 'B'}
		if len(glyphs) != 3 || glyphs[2] != want {
			t.Fatalf("scaled geometry for %s: %#v", show, glyphs)
		}
	}
}

func TestPDFGlyphGeometryKeepsDistinctBaselines(t *testing.T) {
	font := "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 67 /Widths [600 600 600] >>"
	for _, tt := range []struct {
		name, middleY, want string
	}{
		{"common baseline", "720", "ABC"},
		{"separate baselines", "717", "A\nB\nC"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			content := fmt.Sprintf("BT /F1 12 Tf 200 Tz 72 720 Td (A) Tj ET\n"+
				"BT 86 %s Td (B) Tj ET\nBT 100 %s Td (C) Tj ET\n", tt.middleY, tt.middleY)
			parsed, err := Parse(context.Background(), Input{Name: "lettering.pdf", Data: makePDFWithStreams(font, content)})
			if err != nil {
				t.Fatal(err)
			}
			if got := parsed.Sections[0].Text; got != tt.want {
				t.Fatalf("extracted text = %q, want %q", got, tt.want)
			}
		})
	}
}

type pdfReadHook struct {
	*bytes.Reader
	onRead func(offset int64)
}

func (reader *pdfReadHook) ReadAt(data []byte, offset int64) (int, error) {
	if reader.onRead != nil {
		reader.onRead(offset)
	}
	return reader.Reader.ReadAt(data, offset)
}

func readPDFGeometryPage(t *testing.T, reader io.ReaderAt, size int) pdf.Page {
	t.Helper()
	pdfReader, err := pdf.NewReader(reader, int64(size))
	if err != nil {
		t.Fatal(err)
	}
	return pdfReader.Page(1)
}
