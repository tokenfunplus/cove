package interactive

import "strings"

type sourceBlock struct {
	start, end int
	json       string
	candidate  bool
}

// HasCandidate distinguishes a recognized but malformed UI attempt from ordinary
// prose or code examples. It does not imply normalization or validation succeeds.
func HasCandidate(body string) bool {
	block, _ := modelBlock(body)
	return block.candidate
}

func modelFenceLabel(raw string) string {
	tag := strings.ToLower(strings.TrimSpace(raw))
	if tag == "cove-ui" || strings.HasPrefix(tag, "cove-ui ") || strings.HasPrefix(tag, "cove-ui\t") {
		return "cove-ui"
	}
	if tag == "json" || tag == "cove-card-v1" || tag == "cove-card-v2" || tag == "cove-card-v3" {
		return tag
	}
	return ""
}

// modelBlock locates one complete top-level UI payload and its original byte
// span. History projection removes precisely that span, preserving all prose.
func modelBlock(body string) (sourceBlock, error) {
	offset := 0
	for {
		rest := body[offset:]
		trimmed := strings.TrimLeft(rest, " \t\r\n")
		removed := false
		for _, tag := range []string{"think", "reasoning", "analysis"} {
			if !strings.HasPrefix(trimmed, "<"+tag+">") {
				continue
			}
			end := strings.Index(trimmed, "</"+tag+">")
			if end < 0 {
				return sourceBlock{}, ErrInvalid
			}
			offset += len(rest) - len(trimmed) + end + len(tag) + 3
			removed = true
			break
		}
		if !removed {
			break
		}
	}
	fence, label := "", ""
	start, jsonStart, count := 0, 0, 0
	bareStarts := []int{}
	var block sourceBlock
	for _, raw := range strings.Split(body[offset:], "\n") {
		line := strings.TrimRight(raw, " \t\r")
		if fence != "" {
			if len(line) >= len(fence) && strings.Trim(line, string(fence[0])) == "" {
				if label != "" {
					payload := body[jsonStart:offset]
					if label != "json" || markedUI([]byte(payload)) {
						block = sourceBlock{start: start, end: offset + len(raw), json: payload, candidate: true}
						count++
					}
				}
				fence, label = "", ""
			}
		} else if opened := openingFence.FindStringSubmatch(line); opened != nil {
			fence = opened[1]
			if fence == "```" {
				label = modelFenceLabel(opened[2])
				start, jsonStart = offset, offset+len(raw)+1
				if label != "" && label != "json" {
					block.candidate = true
				}
			}
		} else if unfencedUI.MatchString(body[offset:]) {
			bareStarts = append(bareStarts, offset)
			block.candidate = true
		}
		offset += len(raw) + 1
	}
	if count == 0 && fence == "" {
		if len(bareStarts) == 1 {
			start := bareStarts[0]
			_, end, err := modelObject(body[start:])
			if err != nil {
				return block, invalidAt("/json", "incomplete or malformed UI JSON")
			}
			return sourceBlock{start: start, end: start + end, json: body[start : start+end], candidate: true}, nil
		}
	}
	pending := label != "" && label != "json"
	if label == "json" && jsonStart <= len(body) && markedUI([]byte(body[jsonStart:])) {
		pending = true
	}
	block.candidate = block.candidate || pending
	if count != 1 || pending || len(bareStarts) > 0 {
		return block, invalidAt("/fence", "expected one complete marked UI block")
	}
	return block, nil
}
