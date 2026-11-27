package api

import (
	"context"
	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/miniapps"
	"net/http"
	"slices"
)

func (s *Server) appCapabilities(w http.ResponseWriter, r *http.Request) {
	ctx, id := r.Context(), r.PathValue("id")
	i, err := s.apps.Instance(ctx, id)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	p, err := s.apps.Release(ctx, i.ReleaseID)
	if err != nil {
		appReply(w, nil, err)
		return
	}
	states := map[string]string{}
	for _, cap := range p.Package.Capabilities {
		if !i.Enabled || !slices.Contains(i.Grants, cap) {
			states[cap] = "denied"
			continue
		}
		if cap == "speech.speak" && p.Package.SpeechLanguage == "ja" {
			states[cap] = "setup_required"
			if reader, ok := s.chat.(interface{ JapaneseSpeechAvailable(context.Context) bool }); ok && reader.JapaneseSpeechAvailable(ctx) {
				states[cap] = "available"
			}
			continue
		}
		states[cap] = s.capabilityStatus(ctx, cap, r.URL.Query().Get("local_only") == "true")
	}
	writeJSON(w, 200, map[string]any{"host_version": miniapps.RuntimeVersion, "capabilities": states})
}
func (s *Server) capabilityStatus(ctx context.Context, cap string, localOnly bool) string {
	switch cap {
	case "ai.generate", "documents.search":
		if cap == "ai.generate" && !localOnly && s.providerSetup != nil {
			profiles, err := s.providerSetup.List(ctx)
			if err == nil {
				for _, p := range profiles {
					if p.Configured && p.Kind != "local" {
						return "available"
					}
				}
			}
		}
		models, ok := s.chat.(interface {
			LocalModels() ([]localmodels.Status, error)
		})
		if !ok {
			return "unsupported"
		}
		statuses, err := models.LocalModels()
		if err != nil {
			return "setup_required"
		}
		role := "chat"
		if cap == "documents.search" {
			role = "embedding"
		}
		for _, m := range statuses {
			if m.Role == role && m.State == "installed" && m.RuntimeReady {
				return "available"
			}
		}
		return "setup_required"
	case "speech.speak":
		reader, ok := s.chat.(interface {
			SpeechSettings(context.Context) (chat.SpeechConfiguration, error)
		})
		if !ok {
			return "unsupported"
		}
		config, err := reader.SpeechSettings(ctx)
		if err != nil {
			return "setup_required"
		}
		for _, m := range config.Models {
			if m.Installed && m.RuntimeReady && (m.ID == config.Settings.ModelID || m.ID == config.Settings.EnglishModelID || m.ID == config.Settings.ChineseModelID) {
				return "available"
			}
		}
		return "setup_required"
	case "mac.files.pick", "mac.selection.receive":
		if s.controlToken == "" {
			return "unsupported"
		}
	}
	return "available"
}
