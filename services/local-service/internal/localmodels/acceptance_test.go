package localmodels_test

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/credentials"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
)

func TestRealOfflineChatAcceptance(t *testing.T) {
	if os.Getenv("COVE_TEST_LOCAL_INFERENCE") != "1" {
		t.Skip("set COVE_TEST_LOCAL_INFERENCE=1 for real offline model acceptance")
	}
	root := os.Getenv("COVE_DATA_DIR")
	if root == "" {
		root = t.TempDir()
	}
	if !temporaryDescendant(root, "/private/tmp") && !temporaryDescendant(root, os.TempDir()) {
		t.Fatal("acceptance requires a temporary COVE_DATA_DIR")
	}
	modelID := os.Getenv("COVE_TEST_CHAT_MODEL")
	if modelID == "" {
		modelID = localmodels.ChatID
	}
	if !localmodels.IsChatModel(modelID) {
		t.Fatal("acceptance requires a registered local chat model")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	manager := localmodels.New(root, os.Getenv("COVE_INFERENCE_RUNTIME"))
	defer manager.Close()
	started := time.Now()
	if err := manager.Install(modelID); err != nil {
		t.Fatal(err)
	}
	for !manager.Installed(modelID) {
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		for _, status := range manager.Statuses() {
			if status.ID == modelID && status.State == "failed" {
				t.Fatal(status.Error)
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	downloadMS := time.Since(started).Milliseconds()
	router := localmodels.RoutedProvider{Local: manager, Remote: provider.NewHTTPAdapter(nil)}
	profile := manager.Profile()
	profile.Model = modelID
	zero := float64(0)
	limit := 256
	input := func(prompt string) provider.CompletionInput {
		return provider.CompletionInput{Profile: profile, Messages: []provider.ProviderMessage{{Role: "system", Content: "Answer concisely in Chinese. Follow the requested output format."}, {Role: "user", Content: prompt}}, GenerationParameters: provider.GenerationParameters{Temperature: &zero, MaxTokens: &limit}}
	}
	cases := []struct {
		prompt  string
		matches func(string) bool
	}{
		{"\u53ea\u8f93\u51fa\u8bb0\u5f55\u4e2d\u7684\u57ce\u5e02\u540d\u79f0\uff0c\u4e0d\u8981\u89e3\u91ca\u3002\u8bb0\u5f55\uff1a\u59d3\u540d\uff1a\u6797\u6d77\uff1b\u57ce\u5e02\uff1a\u676d\u5dde\uff1b\u559c\u597d\uff1a\u9605\u8bfb\u3002", func(s string) bool { return strings.Contains(s, "\u676d\u5dde") }},
		{"\u628a\u201c\u5468\u4e94\u4e0b\u5348\u4e09\u70b9\u5f00\u4f1a\u201d\u6539\u5199\u6210\u4e00\u6761\u7b80\u6d01\u7684\u4e2d\u6587\u63d0\u9192\uff0c\u4e0d\u8981\u6dfb\u52a0\u5730\u70b9\u3002", func(s string) bool { return strings.Contains(s, "\u5468\u4e94") && strings.Contains(s, "\u4f1a") }},
		{"\u7528\u4e2d\u6587\u4e00\u53e5\u8bdd\u8bf4\u660e\uff1a\u628a\u6587\u4ef6\u5907\u4efd\u5230\u5916\u63a5\u786c\u76d8\u6709\u4ec0\u4e48\u4f5c\u7528\uff1f", func(s string) bool { return strings.Contains(s, "\u6570\u636e") || strings.Contains(s, "\u6587\u4ef6") }},
	}
	quality, deltaCount := 0, 0
	var firstTokenMS int64
	var coldMS int64
	for index, c := range cases {
		started = time.Now()
		stream, err := router.Stream(ctx, input(c.prompt))
		if err != nil {
			t.Fatal(err)
		}
		var text strings.Builder
		chunks := 0
		for {
			event, err := stream.Recv(ctx)
			if err == io.EOF {
				break
			}
			if err != nil {
				stream.Close()
				t.Fatal(err)
			}
			if event.Delta != "" {
				if chunks == 0 && index == 0 {
					firstTokenMS = time.Since(started).Milliseconds()
				}
				chunks++
				text.WriteString(event.Delta)
			}
		}
		stream.Close()
		deltaCount += chunks
		if c.matches(text.String()) {
			quality++
		} else {
			t.Logf("Chinese smoke case %d did not meet its content check", index+1)
		}
		if index == 0 {
			coldMS = manager.Measurement(modelID).LoadMS
		}
	}
	if deltaCount <= len(cases) {
		t.Fatal("responses were not delivered as multiple streamed deltas")
	}
	if quality < len(cases) {
		t.Errorf("Chinese smoke checks: %d/%d", quality, len(cases))
	}
	stopCtx, stop := context.WithCancel(ctx)
	stream, err := router.Stream(stopCtx, input("\u4ece\u4e00\u5f00\u59cb\u6309\u987a\u5e8f\u5217\u51fa\u4e00\u5343\u4e2a\u6574\u6570\uff0c\u4e0d\u8981\u89e3\u91ca\u3002"))
	if err != nil {
		t.Fatal(err)
	}
	for {
		event, err := stream.Recv(stopCtx)
		if err != nil {
			t.Fatal(err)
		}
		if event.Delta != "" {
			break
		}
	}
	started = time.Now()
	stop()
	stream.Close()
	stopMS := time.Since(started).Milliseconds()
	if stopMS > 1500 {
		t.Errorf("Stop took %d ms", stopMS)
	}
	peak := manager.Measurement(modelID).PeakResidentBytes
	store, err := persistence.OpenSQLite(filepath.Join(root, "offline-chat.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	profiles := providerconfig.NewService(store, credentials.NewMemoryStore(), nil)
	profiles.SetLocalProvider(manager)
	settings, err := store.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.ActiveModelSet = []persistence.ActiveModelTarget{{ProviderID: localmodels.ProviderID, ModelID: modelID}}
	settings.MaxTokens = &limit
	settings.Temperature = &zero
	if err = store.UpdateSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	app := chat.NewServiceWithSettings(store, profiles, router, store)
	conversation, err := app.CreateConversation(ctx, "Offline acceptance")
	if err != nil {
		t.Fatal(err)
	}
	batch, err := app.StartGenerationBatch(ctx, chat.SendInput{ConversationID: conversation.ID, ClientRequestID: fmt.Sprintf("offline-%d", time.Now().UnixNano()), Body: cases[0].prompt, LocalOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	for {
		saved, err := store.GetGenerationBatch(ctx, batch.Batch.ID)
		if err != nil {
			t.Fatal(err)
		}
		if saved.State == persistence.GenerationBatchCompleted {
			break
		}
		if saved.State == persistence.GenerationBatchFailed || saved.State == persistence.GenerationBatchCompletedWithErrors {
			t.Fatalf("local Chat lifecycle failed: %s", saved.Targets[0].Generation.ErrorMessage)
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(20 * time.Millisecond)
	}
	view, err := store.LoadConversation(ctx, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Messages) != 2 || view.Messages[1].ProviderSnapshot.ProviderKind != provider.KindLocal {
		t.Fatal("offline answer was not persisted with its local Provider Snapshot")
	}
	model, _ := localmodels.Lookup(modelID)
	artifact := view.Messages[1].ProviderSnapshot.LocalModel
	if artifact == nil || artifact.SHA256 != model.SHA256 || artifact.Revision != model.Revision {
		t.Fatal("saved answer lost the selected model artifact provenance")
	}
	t.Logf("REAL OFFLINE ACCEPTANCE: Chinese smoke=%d/%d; deltas=%d; download_ms=%d; cold_load_ms=%d; first_text_including_load_ms=%d; stop_ms=%d; peak_process_rss_bytes=%d; saved Chat lifecycle passed", quality, len(cases), deltaCount, downloadMS, coldMS, firstTokenMS, stopMS, peak)
}

func temporaryDescendant(path, base string) bool {
	absolute, err := canonicalAcceptancePath(path)
	if err != nil {
		return false
	}
	basePath, err := canonicalAcceptancePath(base)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(basePath, absolute)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func canonicalAcceptancePath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	var tail []string
	for {
		resolved, err := filepath.EvalSymlinks(absolute)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(absolute)
		if parent == absolute {
			return "", err
		}
		tail = append(tail, filepath.Base(absolute))
		absolute = parent
	}
}
