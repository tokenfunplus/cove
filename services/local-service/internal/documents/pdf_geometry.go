package documents

import (
	"context"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

func pdfPageFonts(page pdf.Page) map[string]*pdf.Font {
	fonts := make(map[string]*pdf.Font)
	for _, name := range page.Fonts() {
		font := page.Font(name)
		fonts[name] = &font
	}
	return fonts
}

// pdfTransform stores PDF's six affine matrix operands in their stream order.
type pdfTransform struct{ a, b, c, d, x, y float64 }

func (left pdfTransform) multiply(right pdfTransform) pdfTransform {
	return pdfTransform{
		a: left.a*right.a + left.b*right.c,
		b: left.a*right.b + left.b*right.d,
		c: left.c*right.a + left.d*right.c,
		d: left.c*right.b + left.d*right.d,
		x: left.x*right.a + left.y*right.c + right.x,
		y: left.x*right.b + left.y*right.d + right.y,
	}
}

func (transform pdfTransform) translate(x, y float64) pdfTransform {
	transform.x += x*transform.a + y*transform.c
	transform.y += x*transform.b + y*transform.d
	return transform
}

type pdfTextState struct {
	transform, text, line         pdfTransform
	font                          *pdf.Font
	encoding                      pdf.TextEncoding
	fontSize, scale, rise, lead   float64
	characterSpacing, wordSpacing float64
}

// positionedPDFGlyphs walks text positioning operators with the same cached
// fonts used by GetPlainText. An unreadable geometry stream leaves the plain
// extraction available to the caller.
func positionedPDFGlyphs(ctx context.Context, page pdf.Page, fonts map[string]*pdf.Font) (glyphs []pdf.Text) {
	defer func() {
		if recover() != nil {
			glyphs = nil
		}
	}()
	contents := page.V.Key("Contents")
	if contents.IsNull() {
		return nil
	}
	checkContext := func() {
		if err := ctx.Err(); err != nil {
			// The interpreter callback cannot return an error to stop traversal.
			panic(err)
		}
	}
	identity := pdfTransform{a: 1, d: 1}
	state := pdfTextState{transform: identity, scale: 1}
	var saved []pdfTextState
	var operands []pdf.Value
	moveLine := func(x, y float64) {
		state.line = state.line.translate(x, y)
		state.text = state.line
	}
	showText := func(raw string) {
		decoded := raw
		if state.encoding != nil {
			decoded = state.encoding.Decode(raw)
		}
		if state.wordSpacing != 0 && strings.IndexByte(raw, ' ') >= 0 &&
			(state.font == nil || state.font.V.Key("Subtype").Name() == "Type0" || utf8.RuneCountInString(decoded) != len(raw)) {
			panic("ambiguous PDF word spacing")
		}
		index := 0
		for _, char := range decoded {
			checkContext()
			var width float64
			spacing := state.characterSpacing
			if state.font != nil && index < len(raw) {
				code := raw[index]
				width = state.font.Width(int(code)) / 1000
				if code == ' ' {
					spacing += state.wordSpacing
				}
			}
			index++
			position := state.text.translate(0, state.rise).multiply(state.transform)
			if !(position.a > 0 && position.d > 0 && state.scale > 0) || position.b != 0 || position.c != 0 {
				panic("ambiguous PDF text orientation")
			}
			size := state.fontSize * state.scale * position.a
			glyphs = append(glyphs, pdf.Text{FontSize: size, X: position.x, Y: position.y, W: width * size, S: string(char)})
			state.text = state.text.translate((width*state.fontSize+spacing)*state.scale, 0)
		}
	}
	checkContext()
	pdf.Interpret(contents, func(stack *pdf.Stack, operator string) {
		checkContext()
		operands = slices.Grow(operands[:0], stack.Len())[:stack.Len()]
		for i := len(operands) - 1; i >= 0; i-- {
			operands[i] = stack.Pop()
		}
		need := func(count int) {
			if len(operands) != count {
				panic("invalid PDF positioning operands")
			}
		}
		switch operator {
		case "q":
			saved = append(saved, state)
		case "Q":
			state = saved[len(saved)-1]
			saved = saved[:len(saved)-1]
		case "cm", "Tm":
			need(6)
			transform := pdfTransform{operands[0].Float64(), operands[1].Float64(), operands[2].Float64(), operands[3].Float64(), operands[4].Float64(), operands[5].Float64()}
			if operator == "cm" {
				state.transform = transform.multiply(state.transform)
			} else {
				state.text, state.line = transform, transform
			}
		case "BT":
			state.text, state.line = identity, identity
		case "T*":
			moveLine(0, -state.lead)
		case "Td", "TD":
			need(2)
			x, y := operands[0].Float64(), operands[1].Float64()
			if operator == "TD" {
				state.lead = -y
			}
			moveLine(x, y)
		case "Tf":
			need(2)
			state.font = fonts[operands[0].Name()]
			state.fontSize = operands[1].Float64()
			state.encoding = nil
			if state.font != nil {
				state.encoding = state.font.Encoder()
			}
		case "Tc", "TL", "Ts", "Tw", "Tz":
			need(1)
			value := operands[0].Float64()
			switch operator {
			case "Tc":
				state.characterSpacing = value
			case "TL":
				state.lead = value
			case "Ts":
				state.rise = value
			case "Tw":
				state.wordSpacing = value
			case "Tz":
				state.scale = value / 100
			}
		case "\"", "'", "Tj":
			if operator == "\"" {
				need(3)
				state.wordSpacing = operands[0].Float64()
				state.characterSpacing = operands[1].Float64()
			} else {
				need(1)
			}
			if operator != "Tj" {
				moveLine(0, -state.lead)
			}
			showText(operands[len(operands)-1].RawString())
		case "TJ":
			need(1)
			values := operands[0]
			for i := 0; i < values.Len(); i++ {
				checkContext()
				value := values.Index(i)
				if value.Kind() == pdf.String {
					showText(value.RawString())
				} else {
					state.text = state.text.translate(-value.Float64()/1000*state.fontSize*state.scale, 0)
				}
			}
		}
	})
	return glyphs
}
