package documents

import (
	"context"
	"math"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

const minimumPDFGlyphRun = 3

// GetPlainText inserts a hard break for every PDF text object, including text
// objects that draw individual characters on a shared baseline. Repair only
// contiguous single-character lines with an unambiguous horizontal layout.
func repairPDFGlyphLines(ctx context.Context, page pdf.Page, fonts map[string]*pdf.Font, plain string) string {
	lines := strings.Split(plain, "\n")
	fragments := make([]bool, len(lines))
	run, longest := 0, 0
	for i, line := range lines {
		fragments[i] = isSinglePDFGlyph(line)
		if !fragments[i] {
			run = 0
		} else {
			run++
			longest = max(longest, run)
		}
	}
	if longest < minimumPDFGlyphRun {
		return plain
	}
	geometry, matched := matchPDFGlyphs(lines, positionedPDFGlyphs(ctx, page, fonts))
	if !matched {
		return plain
	}

	repaired := make([]string, 0, len(lines))
	for start := 0; start < len(lines); {
		end := start + 1
		if fragments[start] {
			for end < len(lines) && fragments[end] && samePDFBaseline(geometry[start], geometry[end]) {
				end++
			}
		}
		if end-start >= minimumPDFGlyphRun {
			glyphs := geometry[start:end]
			sort.Slice(glyphs, func(i, j int) bool { return glyphs[i].X < glyphs[j].X })
			if line, ok := joinPDFGlyphs(glyphs); ok {
				repaired = append(repaired, line)
				start = end
				continue
			}
		}
		repaired = append(repaired, lines[start:end]...)
		start = end
	}
	return strings.Join(repaired, "\n")
}

func isSinglePDFGlyph(line string) bool {
	char, size := utf8.DecodeRuneInString(line)
	if size != len(line) || char == utf8.RuneError {
		return false
	}
	// Keep scripts with right-to-left reading order in plain extraction order.
	return unicode.In(char, unicode.Latin, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) ||
		unicode.IsDigit(char) || unicode.IsPunct(char) || unicode.IsSymbol(char)
}

// Align decoded glyphs with plain extraction before trusting their coordinates.
// The coordinate decoder may also emit whitespace for PDF positioning operators.
func matchPDFGlyphs(lines []string, glyphs []pdf.Text) ([]pdf.Text, bool) {
	positions := make([]pdf.Text, len(lines))
	next := 0
	for row, line := range lines {
		for _, char := range line {
			if unicode.IsSpace(char) {
				continue
			}
			for next < len(glyphs) && strings.TrimSpace(glyphs[next].S) == "" {
				next++
			}
			if next == len(glyphs) || glyphs[next].S != string(char) {
				return nil, false
			}
			positions[row] = glyphs[next]
			next++
		}
	}
	for _, glyph := range glyphs[next:] {
		if strings.TrimSpace(glyph.S) != "" {
			return nil, false
		}
	}
	return positions, true
}

func samePDFBaseline(first, next pdf.Text) bool {
	size := min(first.FontSize, next.FontSize)
	return size > 0 && !math.IsInf(size, 0) && math.Abs(first.Y-next.Y) <= size*0.18
}

func joinPDFGlyphs(glyphs []pdf.Text) (string, bool) {
	var line strings.Builder
	line.WriteString(glyphs[0].S)
	for i := 1; i < len(glyphs); i++ {
		previous, current := glyphs[i-1], glyphs[i]
		size := min(previous.FontSize, current.FontSize)
		advance := current.X - previous.X
		// A preserved gap keeps separate columns and cells from being joined.
		if !(size > 0 && advance >= size*0.12 && advance <= size*1.6) {
			return "", false
		}
		previousChar, _ := utf8.DecodeRuneInString(previous.S)
		currentChar, _ := utf8.DecodeRuneInString(current.S)
		if previous.W > size*0.1 && previous.W <= size*1.4 {
			gap := advance - previous.W
			if gap > size*0.6 {
				return "", false
			}
			if gap >= size*0.22 && isLatinWordGlyph(previousChar) && isLatinWordGlyph(currentChar) {
				line.WriteByte(' ')
			}
		} else if isLatinWordGlyph(previousChar) || isLatinWordGlyph(currentChar) {
			// Without a reliable width, a Latin word boundary cannot be inferred.
			return "", false
		}
		line.WriteString(current.S)
	}
	return line.String(), true
}

func isLatinWordGlyph(char rune) bool {
	return unicode.Is(unicode.Latin, char) || char >= '0' && char <= '9'
}
