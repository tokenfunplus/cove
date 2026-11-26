// Command interactive-eval runs synthetic prompts against an explicitly selected model.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
)

type testCase struct {
	ID, Prompt string
	Card       bool
}
type result struct {
	ID                   string `json:"id"`
	ExpectedCard         bool   `json:"expected_card"`
	Attempted            bool   `json:"attempted"`
	Valid                bool   `json:"valid"`
	Error                string `json:"error,omitempty"`
	PromptTokens         int    `json:"prompt_tokens"`
	OutputTokens         int    `json:"output_tokens"`
	BaselinePromptTokens int    `json:"baseline_prompt_tokens"`
	BaselineOutputTokens int    `json:"baseline_output_tokens"`
	Milliseconds         int64  `json:"milliseconds"`
}

var cases = []testCase{
	{"greeting", "Hi!", false}, {"arithmetic", "What is 12 times 7?", false}, {"fact", "What is the capital of France?", false}, {"explanation", "Explain why the sky looks blue in two sentences.", false}, {"thanks", "Thank you, that helped.", false}, {"translate", "Translate 'Good morning' into French. Just give the translation.", false}, {"code", "Show a tiny Python function that adds two numbers.", false}, {"definition", "What does serendipity mean?", false}, {"plain-request", "Explain photosynthesis in plain text, without any interactive card.", false}, {"acknowledge", "Sounds good. Let's leave it there.", false},
	{"weekend", "I'm tired and torn between a quiet book, a walk, and visiting a gallery this weekend. Help me choose something that fits.", true},
	{"quiz", "Help me practice astronomy with one short question that I can answer and check here.", true},
	{"ranking", "I need to rank salary, flexibility and learning for my next job. Let me arrange their priority.", true},
	{"budget", "I have a 100 dollar weekend budget for food and travel. Let me adjust the amounts and see the balance.", true},
	{"edit", "Draft a short invitation to a Saturday gallery visit. Let me edit it and see a preview before we refine it.", true},
	{"recall", "Teach me one new English word. Let me reveal the definition when I am ready; no follow-up model turn is needed.", true},
	{"story", "Let's play a lighthouse mystery. Give me a short scene and a few actions I can choose between.", true},
	{"packing", "I am packing light. Let me pick up to three items from a camera, a book, a jacket and snacks.", true},
	{"remix", "Help me invent a character by combining a role and a personality from a few options.", true},
	{"preference", "I'm choosing between a beach trip and a city break. Give me a simple interactive way to pick my preference.", true},
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "normalize" || os.Args[1] == "extract") {
		raw, err := readEvaluationInput(os.Args[1], os.Stdin)
		if err == nil {
			var d interactive.Definition
			if os.Args[1] == "extract" {
				d, err = interactive.Extract(string(raw))
			} else {
				d, err = interactive.Normalize(raw)
			}
			if err == nil {
				json.NewEncoder(os.Stdout).Encode(d)
				return
			}
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	model := os.Getenv("COVE_EVAL_MODEL")
	if model == "" {
		return fmt.Errorf("set COVE_EVAL_MODEL")
	}
	endpoint := os.Getenv("COVE_EVAL_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:11434/api/chat"
	}
	key := os.Getenv("COVE_EVAL_API_KEY")
	endpoint, err := validateEvaluationEndpoint(endpoint, key)
	if err != nil {
		return err
	}
	output, err := evaluationOutputDirectory(os.Getenv("COVE_EVAL_OUTPUT"))
	if err != nil {
		return err
	}
	fmt.Println("Evaluation output:", output)
	records := []result{}
	client := evaluationClient()
	request := func(prompt, guide string) (string, int, int, error) {
		messages := []map[string]string{}
		if guide != "" {
			messages = append(messages, map[string]string{"role": "system", "content": guide})
		}
		messages = append(messages, map[string]string{"role": "user", "content": prompt})
		payload := map[string]any{"model": model, "messages": messages, "stream": false}
		ollama := strings.HasSuffix(endpoint, "/api/chat")
		if ollama {
			payload["options"] = map[string]any{"temperature": 0, "seed": 42, "num_ctx": 8192, "num_predict": 768}
		} else {
			payload["temperature"] = 0
			payload["max_tokens"] = 768
		}
		raw, _ := json.Marshal(payload)
		req, err := http.NewRequestWithContext(context.Background(), "POST", endpoint, bytes.NewReader(raw))
		if err != nil {
			return "", 0, 0, err
		}
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		response, err := client.Do(req)
		if err != nil {
			return "", 0, 0, fmt.Errorf("model request failed")
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return "", 0, 0, fmt.Errorf("model returned status %d", response.StatusCode)
		}
		raw, err = io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			return "", 0, 0, err
		}
		var data struct {
			Message         struct{ Content string }
			PromptEvalCount int `json:"prompt_eval_count"`
			EvalCount       int `json:"eval_count"`
			Choices         []struct{ Message struct{ Content string } }
			Usage           struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			}
		}
		if err = json.Unmarshal(raw, &data); err != nil {
			return "", 0, 0, err
		}
		if ollama {
			return data.Message.Content, data.PromptEvalCount, data.EvalCount, nil
		}
		if len(data.Choices) == 0 {
			return "", 0, 0, fmt.Errorf("model returned no choices")
		}
		return data.Choices[0].Message.Content, data.Usage.PromptTokens, data.Usage.CompletionTokens, nil
	}
	for _, c := range cases {
		start := time.Now()
		body, promptTokens, outputTokens, err := request(c.Prompt, interactive.Prompt())
		r := result{ID: c.ID, ExpectedCard: c.Card, PromptTokens: promptTokens, OutputTokens: outputTokens, Milliseconds: time.Since(start).Milliseconds()}
		if err != nil {
			r.Error = err.Error()
		} else {
			r.Attempted = interactive.HasCandidate(body)
			_, parseErr := interactive.Extract(body)
			r.Valid = parseErr == nil
			if r.Attempted && parseErr != nil {
				r.Error = parseErr.Error()
			}
		}
		if err = os.WriteFile(filepath.Join(output, c.ID+".txt"), []byte(body), 0600); err != nil {
			return err
		}
		_, r.BaselinePromptTokens, r.BaselineOutputTokens, err = request(c.Prompt, "")
		if err != nil && r.Error == "" {
			r.Error = "baseline: " + err.Error()
		}
		records = append(records, r)
		raw, _ := json.MarshalIndent(map[string]any{"model": model, "guide_characters": len([]rune(interactive.Prompt())), "cases": records}, "", "  ")
		if err = os.WriteFile(filepath.Join(output, "results.json"), raw, 0600); err != nil {
			return err
		}
		fmt.Printf("%s expected_card=%t attempted=%t valid=%t tokens=%d+%d baseline=%d+%d\n", c.ID, c.Card, r.Attempted, r.Valid, r.PromptTokens, r.OutputTokens, r.BaselinePromptTokens, r.BaselineOutputTokens)
	}
	return nil
}

func evaluationOutputDirectory(output string) (string, error) {
	if output == "" {
		return os.MkdirTemp("", "cove-interactive-evaluation-")
	}
	if err := os.MkdirAll(output, 0700); err != nil {
		return "", err
	}
	return output, nil
}

func validateEvaluationEndpoint(endpoint, key string) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("evaluation endpoint must be an HTTP or HTTPS URL without user information")
	}
	if key != "" && u.Scheme != "https" {
		return "", fmt.Errorf("credentialed evaluation requires HTTPS")
	}
	return endpoint, nil
}

func evaluationClient() *http.Client {
	return &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func readEvaluationInput(mode string, input io.Reader) ([]byte, error) {
	limit := int64(32768)
	if mode == "extract" {
		limit = 1 << 20
	}
	raw, err := io.ReadAll(io.LimitReader(input, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("evaluation input exceeds %d bytes", limit)
	}
	return raw, nil
}
