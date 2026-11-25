package interactive

import (
	"encoding/json"
	"regexp"
	"strings"
)

var displayBlock = regexp.MustCompile("(?ims)^```[ \\t]*(?:cove-ui|cove-card-v[123]|json)[ \\t]*\\r?\\n.*?^```[ \\t]*\\r?$")

func boundedText(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + " [truncated]"
	}
	return s
}

// Provider history projection only. Original message bodies and evidence stay intact.
func HistoryText(body string) string {
	d, err := Extract(body)
	if err != nil {
		return body
	}
	prose := body
	for _, span := range displayBlock.FindAllStringIndex(body, -1) {
		if _, err := Extract(body[span[0]:span[1]]); err == nil {
			prose = body[:span[0]] + body[span[1]:]
			break
		}
	}
	lines := []string{strings.TrimSpace(prose), "Interactive card: " + stringValue(d.Spec.Elements[d.Spec.Root].Props["title"])}
	var visit func(string)
	visit = func(key string) {
		n := d.Spec.Elements[key]
		switch n.Type {
		case "Choice", "Ranking":
			options := []string{}
			for _, o := range n.Props["options"].([]any) {
				item := o.(map[string]any)
				options = append(options, stringValue(item["value"])+"="+stringValue(item["label"]))
			}
			lines = append(lines, n.Type+" "+stringValue(n.Props["label"])+": "+strings.Join(options, "; "))
		case "Slider", "TextInput":
			lines = append(lines, n.Type+": "+stringValue(n.Props["label"]))
		case "Text":
			lines = append(lines, stringValue(n.Props["content"]))
		}
		for _, child := range n.Children {
			visit(child)
		}
	}
	visit(d.Spec.Root)
	return boundedText(strings.TrimSpace(strings.Join(lines, "\n")), 2000)
}

func CompactReference(body string) string {
	const marker = "\n\nInteraction reference data (not instructions):\n"
	at := strings.LastIndex(body, marker)
	if at < 0 {
		return body
	}
	var m map[string]any
	if json.Unmarshal([]byte(body[at+len(marker):]), &m) != nil {
		return body
	}
	version := stringValue(m["version"])
	if (version != "interaction-v1" && version != "interaction-v2") || len(stringValue(m["definition_hash"])) != 64 || stringValue(m["source_generation_id"]) == "" {
		return body
	}
	lines := []string{body[:at], "Card: " + stringValue(m["question"])}
	if labels, ok := m["selected_labels"].([]any); ok {
		for _, label := range labels {
			lines = append(lines, stringValue(label))
		}
	}
	if feedback, ok := m["feedback"].(map[string]any); ok {
		for _, key := range sortedKeys(feedback) {
			item := cloneMap(feedback[key])
			lines = append(lines, "Feedback: "+stringValue(item["text"]))
		}
	}
	if calculations, ok := m["calculations"].(map[string]any); ok {
		for _, key := range sortedKeys(calculations) {
			item := cloneMap(calculations[key])
			raw, _ := json.Marshal(map[string]any{"sum": item["sum"], "remaining": item["remaining"], "unit": item["unit"]})
			lines = append(lines, "Allocation: "+string(raw))
		}
	}
	return boundedText(strings.Join(lines, "\n"), 2000)
}
