package speech

import (
	"errors"
	"html"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
)

var citationText = regexp.MustCompile(`\[(?:S\d+|\d+)(?:[-, ]+(?:S\d+|\d+))*\]`)
var leadingReasoning = regexp.MustCompile(`(?i)^\s*<(think|reasoning|analysis)>`)

// Match the Chat Surface's presentation-only leading-block projection.
func answerText(value string) string {
	for {
		opening := leadingReasoning.FindStringSubmatchIndex(value)
		if opening == nil {
			return value
		}
		tag := strings.ToLower(value[opening[2]:opening[3]])
		body := value[opening[1]:]
		closing := regexp.MustCompile(`(?i)</` + tag + `>`).FindStringIndex(body)
		if closing == nil {
			return ""
		}
		value = body[closing[1]:]
	}
}

func selectionText(value string) (string, error) {
	if !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > 6000 {
		return "", errors.New("Select up to 6,000 characters for reading.")
	}
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "", errors.New("Select some text to read aloud.")
	}
	return value, nil
}

func PlainText(markdown string, includeCode bool) (string, error) {
	if !utf8.ValidString(markdown) || strings.ContainsRune(markdown, 0) || utf8.RuneCountInString(markdown) > 120000 {
		return "", errors.New("This answer cannot be prepared for local reading.")
	}
	source := []byte(answerText(markdown))
	document := goldmark.New(goldmark.WithExtensions(extension.GFM)).Parser().Parse(text.NewReader(source))
	var out strings.Builder
	var prose strings.Builder
	flushProse := func() { out.WriteString(citationText.ReplaceAllString(prose.String(), "")); prose.Reset() }
	err := ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			if node.Kind().String() == "TableCell" {
				prose.WriteByte(' ')
			}
			if node.Type() == ast.TypeBlock {
				prose.WriteByte('\n')
			}
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.FencedCodeBlock:
			if includeCode {
				flushProse()
				lines := n.Lines()
				for i := 0; i < lines.Len(); i++ {
					segment := lines.At(i)
					out.Write(segment.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeBlock:
			if includeCode {
				flushProse()
				lines := n.Lines()
				for i := 0; i < lines.Len(); i++ {
					segment := lines.At(i)
					out.Write(segment.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeSpan:
			if includeCode {
				flushProse()
				out.Write(n.Text(source))
			}
			return ast.WalkSkipChildren, nil
		case *ast.RawHTML, *ast.HTMLBlock, *ast.Image:
			return ast.WalkSkipChildren, nil
		case *ast.AutoLink:
			return ast.WalkSkipChildren, nil
		case *ast.Text:
			prose.Write(n.Segment.Value(source))
			if n.SoftLineBreak() || n.HardLineBreak() {
				prose.WriteByte('\n')
			}
		case *ast.String:
			prose.Write(n.Value)
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return "", err
	}
	flushProse()
	value := html.UnescapeString(out.String())
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "", errors.New("This answer has no readable text. Code blocks are skipped unless enabled in Speech settings.")
	}
	if utf8.RuneCountInString(value) > 6000 {
		return "", errors.New("This answer is too long for one reading. Select a passage of up to 6,000 characters.")
	}
	return value, nil
}
