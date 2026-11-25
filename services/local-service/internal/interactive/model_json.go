package interactive

import (
	"strings"
	"unicode/utf8"
)

// modelObject repairs only an object closer missing before an array closer and
// surplus closers after a completed root. It never completes truncated output or
// changes strings, values, commas, or colons. Decode and Parse remain authoritative.
func modelObject(raw string) (string, int, error) {
	var out strings.Builder
	stack := []byte{}
	quoted, escaped, started := false, false, false
	edits := 0
	for i := 0; i < len(raw) && i < 32768; i++ {
		c := raw[i]
		if quoted {
			out.WriteByte(c)
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		if !started && c != '{' && c != ' ' && c != '\t' && c != '\r' && c != '\n' {
			return "", 0, ErrInvalid
		}
		switch c {
		case '"':
			quoted = true
		case '{', '[':
			started = true
			stack = append(stack, c)
			if len(stack) > 32 {
				return "", 0, ErrInvalid
			}
		case ']', '}':
			if c == ']' {
				for len(stack) > 0 && stack[len(stack)-1] == '{' {
					out.WriteByte('}')
					stack = stack[:len(stack)-1]
					edits++
				}
			}
			if edits > 8 || len(stack) == 0 || (c == '}' && stack[len(stack)-1] != '{') || (c == ']' && stack[len(stack)-1] != '[') {
				return "", 0, ErrInvalid
			}
			stack = stack[:len(stack)-1]
		}
		out.WriteByte(c)
		if started && len(stack) == 0 {
			end := i + 1
			for j := end; j < len(raw) && j < 32768; j++ {
				if raw[j] == ' ' || raw[j] == '\t' || raw[j] == '\r' || raw[j] == '\n' {
					continue
				}
				if raw[j] != '}' && raw[j] != ']' {
					break
				}
				edits++
				if edits > 8 {
					return "", 0, ErrInvalid
				}
				end = j + 1
			}
			if !utf8.ValidString(raw[:end]) {
				return "", 0, ErrInvalid
			}
			return out.String(), end, nil
		}
	}
	return "", 0, ErrInvalid
}

func decodeModelJSON(raw []byte) (any, error) {
	v, err := Decode(raw)
	if err == nil || len(raw) > 32768 {
		return v, err
	}
	repaired, end, err := modelObject(string(raw))
	if err != nil || strings.TrimSpace(string(raw[end:])) != "" {
		return nil, ErrInvalid
	}
	return Decode([]byte(repaired))
}
