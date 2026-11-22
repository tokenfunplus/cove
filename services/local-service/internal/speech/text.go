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

func PlainText(markdown string, includeCode bool) (string, error) {
	if !utf8.ValidString(markdown) || strings.ContainsRune(markdown, 0) || utf8.RuneCountInString(markdown) > 120000 {
		return "", errors.New("This answer cannot be prepared for local reading.")
	}
	source := []byte(markdown)
	document := goldmark.New(goldmark.WithExtensions(extension.GFM)).Parser().Parse(text.NewReader(source))
	var out strings.Builder
	err := ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			if node.Kind().String() == "TableCell" {
				out.WriteByte(' ')
			}
			if node.Type() == ast.TypeBlock {
				out.WriteByte('\n')
			}
			return ast.WalkContinue, nil
		}
		switch n := node.(type) {
		case *ast.FencedCodeBlock:
			if includeCode {
				lines := n.Lines()
				for i := 0; i < lines.Len(); i++ {
					segment := lines.At(i)
					out.Write(segment.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeBlock:
			if includeCode {
				lines := n.Lines()
				for i := 0; i < lines.Len(); i++ {
					segment := lines.At(i)
					out.Write(segment.Value(source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeSpan:
			if !includeCode {
				return ast.WalkSkipChildren, nil
			}
		case *ast.RawHTML, *ast.HTMLBlock, *ast.Image:
			return ast.WalkSkipChildren, nil
		case *ast.AutoLink:
			return ast.WalkSkipChildren, nil
		case *ast.Text:
			out.Write(n.Segment.Value(source))
			if n.SoftLineBreak() || n.HardLineBreak() {
				out.WriteByte('\n')
			}
		case *ast.String:
			out.Write(n.Value)
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return "", err
	}
	value := html.UnescapeString(out.String())
	value = citationText.ReplaceAllString(value, "")
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return "", errors.New("This answer has no readable text. Code blocks are skipped unless enabled in Speech settings.")
	}
	if utf8.RuneCountInString(value) > 6000 {
		return "", errors.New("This answer is too long for one reading. Select a passage of up to 6,000 characters.")
	}
	return value, nil
}
