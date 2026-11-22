package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/provider"
	"github.com/tokenfunplus/cove/services/local-service/internal/providerconfig"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

const maxNvidiaEvidenceBytes = 2 << 20

type Config struct {
	SearchService   *websearch.Service
	Security        *localsecurity.Manager
	LaunchToken     string
	ControlToken    string
	Clock           func() time.Time
	Shutdown        func()
	Store           persistence.ChatStore
	Settings        persistence.SettingsStore
	Chat            chat.Chat
	ProviderSetup   *providerconfig.Service
	NearAIProxy     *provider.NearAIProxy
	NvidiaNRASProxy *provider.NvidiaNRASProxy
}

type Server struct {
	searchService   *websearch.Service
	security        *localsecurity.Manager
	controlToken    string
	shutdown        func()
	settings        persistence.SettingsStore
	chat            chat.Chat
	providerSetup   *providerconfig.Service
	nearAIProxy     *provider.NearAIProxy
	nvidiaNRASProxy *provider.NvidiaNRASProxy
}

type ErrorEnvelope struct {
	Error APIError `json:"error"`
}

type APIError struct {
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	Details   json.RawMessage `json:"details"`
	RequestID string          `json:"request_id"`
}

func NewServer(config Config) *Server {
	security := config.Security
	if security == nil {
		security = localsecurity.New(config.Clock, nil)
	}
	if config.LaunchToken != "" {
		security.RegisterLaunchToken(config.LaunchToken)
	}
	shutdown := config.Shutdown
	if shutdown == nil {
		shutdown = func() {}
	}
	settings := config.Settings
	if settings == nil {
		settings, _ = config.Store.(persistence.SettingsStore)
	}
	chatService := config.Chat
	if chatService == nil && config.Store != nil {
		chatService = chat.NewService(config.Store, nil, nil)
	}
	nvidiaNRASProxy := config.NvidiaNRASProxy
	if nvidiaNRASProxy == nil {
		nvidiaNRASProxy = provider.NewNvidiaNRASProxy(nil)
	}
	return &Server{searchService: config.SearchService, security: security, controlToken: config.ControlToken, shutdown: shutdown, settings: settings, chat: chatService, providerSetup: config.ProviderSetup, nearAIProxy: config.NearAIProxy, nvidiaNRASProxy: nvidiaNRASProxy}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	browserSession := server.security.RequireBrowserSession(server.writeSecurityError)
	mux.HandleFunc("GET /launch", server.launch)
	mux.Handle("GET /api/session", browserSession(http.HandlerFunc(server.session)))
	mux.HandleFunc("GET /api/health", server.health)
	mux.Handle("GET /api/conversations", browserSession(http.HandlerFunc(server.listConversations)))
	mux.Handle("GET /api/conversations/search", browserSession(http.HandlerFunc(server.searchConversations)))
	mux.Handle("GET /api/projects", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("POST /api/projects", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("GET /api/projects/{project}", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("PATCH /api/projects/{project}", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("DELETE /api/projects/{project}", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("POST /api/projects/{project}/sources", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("POST /api/projects/{project}/sources/{source}/remove", browserSession(http.HandlerFunc(server.projects)))
	mux.Handle("POST /api/conversations/{id}/project", browserSession(http.HandlerFunc(server.moveProjectConversation)))
	mux.Handle("POST /api/conversations", browserSession(http.HandlerFunc(server.createConversation)))
	mux.Handle("POST /api/debates", browserSession(http.HandlerFunc(server.createDebate)))
	mux.Handle("GET /api/debates/{id}", browserSession(http.HandlerFunc(server.getDebate)))
	mux.Handle("GET /api/debates/{id}/turns/{turn}", browserSession(http.HandlerFunc(server.getDebateTurn)))
	mux.Handle("POST /api/debates/{id}/turns/{turn}/browser/claim", browserSession(http.HandlerFunc(server.claimDebateBrowserTurn)))
	mux.Handle("POST /api/debates/{id}/turns/{turn}/browser/progress", browserSession(http.HandlerFunc(server.progressDebateBrowserTurn)))
	mux.Handle("POST /api/debates/{id}/turns/{turn}/browser/settle", browserSession(http.HandlerFunc(server.settleDebateBrowserTurn)))
	mux.Handle("GET /api/debates/{id}/events", browserSession(http.HandlerFunc(server.debateEvents)))
	mux.Handle("POST /api/debates/{id}/control", browserSession(http.HandlerFunc(server.controlDebate)))
	mux.Handle("PATCH /api/debates/{id}/rules", browserSession(http.HandlerFunc(server.updateDebateRules)))
	mux.Handle("PATCH /api/debates/{id}/controls", browserSession(http.HandlerFunc(server.updateDebateControls)))
	mux.Handle("POST /api/debates/{id}/interventions", browserSession(http.HandlerFunc(server.addDebateIntervention)))
	mux.Handle("GET /api/settings", browserSession(http.HandlerFunc(server.getSettings)))
	mux.Handle("PATCH /api/settings", browserSession(http.HandlerFunc(server.updateSettings)))
	mux.Handle("GET /api/conversations/{id}", browserSession(http.HandlerFunc(server.getConversation)))
	mux.Handle("PATCH /api/conversations/{id}", browserSession(http.HandlerFunc(server.renameConversation)))
	mux.Handle("DELETE /api/conversations/{id}", browserSession(http.HandlerFunc(server.deleteConversation)))
	mux.Handle("DELETE /api/data", browserSession(http.HandlerFunc(server.clearChatData)))
	mux.Handle("GET /api/conversations/{id}/messages", browserSession(http.HandlerFunc(server.getConversationMessages)))
	mux.Handle("POST /api/conversations/{id}/messages", browserSession(http.HandlerFunc(server.createGeneration)))
	mux.Handle("POST /api/attachments/preview", browserSession(http.HandlerFunc(server.previewAttachment)))
	mux.Handle("POST /api/web-search/test", browserSession(http.HandlerFunc(server.testWebSearchConnection)))
	mux.Handle("GET /api/web-search/settings", browserSession(http.HandlerFunc(server.webSearchSettings)))
	mux.Handle("PUT /api/web-search/settings", browserSession(http.HandlerFunc(server.saveWebSearchSettings)))
	mux.Handle("DELETE /api/web-search/providers/{provider}", browserSession(http.HandlerFunc(server.deleteWebSearchProvider)))
	mux.Handle("POST /api/generations/{id}/web-search/tools", browserSession(http.HandlerFunc(server.executeWebTool)))
	mux.Handle("GET /api/generations/{id}/web-search/tools/{call}", browserSession(http.HandlerFunc(server.getWebTool)))
	mux.Handle("POST /api/web-sources/prepare", browserSession(http.HandlerFunc(server.prepareWebSource)))
	mux.Handle("DELETE /api/web-sources/{token}", browserSession(http.HandlerFunc(server.releaseWebSource)))
	mux.Handle("POST /api/conversations/{id}/context-preview", browserSession(http.HandlerFunc(server.previewGenerationContext)))
	mux.Handle("GET /api/generation-batches/{id}/attachments/{document}", browserSession(http.HandlerFunc(server.downloadAttachment)))
	mux.Handle("GET /api/generation-batches/{id}", browserSession(http.HandlerFunc(server.getGenerationBatch)))
	mux.Handle("GET /api/generation-batches/{id}/context", browserSession(http.HandlerFunc(server.getGenerationBatchContext)))
	mux.Handle("GET /api/generation-batches/{id}/events", browserSession(http.HandlerFunc(server.generationBatchEvents)))
	mux.Handle("POST /api/generation-batches/{id}/cancel", browserSession(http.HandlerFunc(server.cancelGenerationBatch)))
	mux.Handle("POST /api/generation-batches/{id}/skip-context", browserSession(http.HandlerFunc(server.skipGenerationBatchContext)))
	mux.Handle("GET /api/generations/{id}", browserSession(http.HandlerFunc(server.getGeneration)))
	mux.Handle("GET /api/generations/{id}/events", browserSession(http.HandlerFunc(server.generationEvents)))
	mux.Handle("POST /api/generations/{id}/cancel", browserSession(http.HandlerFunc(server.cancelGeneration)))
	mux.Handle("POST /api/generations/{id}/secure/environment", browserSession(http.HandlerFunc(server.secureGenerationEnvironment)))
	mux.Handle("POST /api/generations/{id}/secure/streaming", browserSession(http.HandlerFunc(server.secureGenerationStreaming)))
	mux.Handle("POST /api/generations/{id}/secure/response", browserSession(http.HandlerFunc(server.secureGenerationResponse)))
	mux.Handle("POST /api/generations/{id}/secure/settle", browserSession(http.HandlerFunc(server.secureGenerationSettle)))
	mux.Handle("POST /api/generations/{id}/select", browserSession(http.HandlerFunc(server.selectGenerationAnswer)))
	mux.Handle("POST /api/generation-targets/{id}/retry", browserSession(http.HandlerFunc(server.retryGenerationTarget)))
	mux.Handle("GET /api/models", browserSession(http.HandlerFunc(server.listProviderProfiles)))
	mux.Handle("POST /api/models", browserSession(http.HandlerFunc(server.createProviderProfile)))
	mux.Handle("GET /api/models/{id}", browserSession(http.HandlerFunc(server.getProviderProfile)))
	mux.Handle("PATCH /api/models/{id}", browserSession(http.HandlerFunc(server.updateProviderProfile)))
	mux.Handle("DELETE /api/models/{id}", browserSession(http.HandlerFunc(server.deleteProviderProfile)))
	mux.Handle("DELETE /api/models/{id}/key", browserSession(http.HandlerFunc(server.deleteProviderKey)))
	mux.Handle("GET /api/models/{id}/catalog", browserSession(http.HandlerFunc(server.discoverProviderModels)))
	mux.Handle("POST /api/models/test", browserSession(http.HandlerFunc(server.testProviderConnection)))
	mux.Handle("POST /api/verification/nvidia", browserSession(http.HandlerFunc(server.forwardNvidiaEvidence)))
	mux.Handle("GET /api/nearai/{providerID}/v1/attestation/report", browserSession(http.HandlerFunc(server.forwardNearAI)))
	mux.Handle("GET /api/nearai/{providerID}/v1/model/{modelID}", browserSession(http.HandlerFunc(server.forwardNearAI)))
	mux.Handle("POST /api/nearai/{providerID}/v1/chat/completions", browserSession(http.HandlerFunc(server.forwardNearAI)))
	mux.Handle("POST /api/nearai/{providerID}/v1/responses", browserSession(http.HandlerFunc(server.forwardNearAI)))
	mux.Handle("GET /api/nearai/{providerID}/v1/signature/{completionID}", browserSession(http.HandlerFunc(server.forwardNearAI)))
	control := localsecurity.RequireControlToken(server.controlToken, server.writeSecurityError)
	mux.Handle("POST /internal/control/shutdown", control(http.HandlerFunc(server.controlShutdown)))
	mux.Handle("POST /internal/control/launch-token", control(http.HandlerFunc(server.controlLaunchToken)))
	mux.Handle("POST /internal/control/status", control(http.HandlerFunc(server.launcherStatus)))
	mux.HandleFunc("/api/", server.apiNotFound)
	mux.HandleFunc("GET /assets/{path...}", server.assets)
	mux.HandleFunc("GET /{$}", server.shell)
	return localsecurity.RequireLoopbackHost(server.writeSecurityError)(server.security.RequireBrowserMutations(server.writeSecurityError)(mux))
}

func (server *Server) forwardNvidiaEvidence(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(writer, http.StatusUnsupportedMediaType, "unsupported_media_type", "NVIDIA evidence must use application/json.")
		return
	}
	limited := http.MaxBytesReader(writer, request.Body, maxNvidiaEvidenceBytes)
	evidence, err := io.ReadAll(limited)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request_too_large", "NVIDIA evidence exceeds the allowed size.")
			return
		}
		writeError(writer, http.StatusBadRequest, "invalid_request", "NVIDIA evidence could not be read.")
		return
	}
	if err := server.nvidiaNRASProxy.Forward(writer, request, evidence); err != nil {
		writeError(writer, http.StatusBadGateway, "attestation_service_unavailable", "NVIDIA attestation could not be reached.")
	}
}

func (server *Server) forwardNearAI(writer http.ResponseWriter, request *http.Request) {
	if server.nearAIProxy == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	upstreamPath := strings.TrimPrefix(request.URL.Path, "/api/nearai/"+request.PathValue("providerID"))
	if modelID := request.PathValue("modelID"); modelID != "" {
		upstreamPath = "/v1/model/" + url.PathEscape(modelID)
	}
	if err := server.nearAIProxy.Forward(writer, request, request.PathValue("providerID"), upstreamPath); err != nil {
		switch {
		case errors.Is(err, provider.ErrNearAIProxyRoute):
			writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		case errors.Is(err, provider.ErrNearAIProxyUnconfigured):
			writeError(writer, http.StatusConflict, "provider_unconfigured", "Configure the NearAI Provider Key before starting private inference.")
		case errors.Is(err, provider.ErrNearAIProxyProvider):
			writeError(writer, http.StatusBadRequest, "private_inference_unavailable", "This Provider cannot use private inference.")
		case errors.Is(err, provider.ErrNearAIProxyRedirect):
			writeError(writer, http.StatusBadGateway, "private_inference_unavailable", "Private inference rejected an unexpected Provider redirect.")
		default:
			writeError(writer, http.StatusBadGateway, "private_inference_unavailable", "Private inference could not reach the Provider.")
		}
	}
}

func (server *Server) controlShutdown(writer http.ResponseWriter, request *http.Request) {
	server.shutdown()
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "shutting_down"})
}

func (server *Server) controlLaunchToken(writer http.ResponseWriter, request *http.Request) {
	token, err := server.security.MintLaunchToken()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "The Local Service could not create a browser token.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"launch_token": token})
}

func (server *Server) launch(writer http.ResponseWriter, request *http.Request) {
	session, err := server.security.ConsumeLaunchToken(request.URL.Query().Get("token"))
	if err != nil {
		writeError(writer, http.StatusUnauthorized, "invalid_launch_token", "The launch token is invalid or expired.")
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Referrer-Policy", "no-referrer")
	// The browser consumes the fragment locally. Other loopback ports never
	// receive an ambient credential from loading this page.
	fragment := url.Values{"cove-session": {session.ID}}
	if intent := request.URL.Query().Get("intent"); intent == "settings" || intent == "new-chat" || intent == "provider-setup" {
		fragment.Set("intent", intent)
	}
	writer.Header().Set("Location", "/#"+fragment.Encode())
	writer.WriteHeader(http.StatusSeeOther)
}

func (server *Server) session(writer http.ResponseWriter, request *http.Request) {
	session, _ := localsecurity.SessionFromRequest(request)
	writeJSON(writer, http.StatusOK, map[string]string{"csrf_token": session.CSRFToken})
}

func (server *Server) getSettings(writer http.ResponseWriter, request *http.Request) {
	if server.settings == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Workspace settings are unavailable.")
		return
	}
	settings, err := server.settings.GetSettings(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Workspace settings are unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, settings)
}

func (server *Server) updateSettings(writer http.ResponseWriter, request *http.Request) {
	if server.settings == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Workspace settings are unavailable.")
		return
	}
	var settings persistence.Settings
	if err := decodeJSON(request, &settings); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The workspace settings are invalid.")
		return
	}
	current, err := server.settings.GetSettings(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Workspace settings are unavailable.")
		return
	}
	if server.chat != nil && server.chat.HasActiveGenerationBatch() && !reflect.DeepEqual(current.ActiveModelSet, settings.ActiveModelSet) {
		writeError(writer, http.StatusConflict, "generation_batch_in_progress", "Wait for the active Generation Batch to finish before changing the Active Model Set.")
		return
	}
	if err := server.settings.UpdateSettings(request.Context(), settings); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The workspace settings are invalid.")
		return
	}
	updated, err := server.settings.GetSettings(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Workspace settings are unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, updated)
}

func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok", "schema_version": "v1"})
}

func (server *Server) apiNotFound(writer http.ResponseWriter, _ *http.Request) {
	writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
}

func (server *Server) listConversations(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Local history is unavailable.")
		return
	}
	archived := false
	if value := request.URL.Query().Get("archived"); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "validation", "The conversation filter is invalid.")
			return
		}
		archived = parsed
	}
	conversations, err := server.chat.ListConversations(request.Context(), archived)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Local history is unavailable.")
		return
	}
	if request.URL.Query().Has("project_id") {
		p, ok := server.chat.(chat.ProjectChat)
		if !ok {
			writeError(writer, 503, "unavailable", "Project history is unavailable.")
			return
		}
		conversations, err = p.ListProjectConversations(request.Context(), archived, request.URL.Query().Get("project_id"))
		if err != nil {
			writeProjectError(writer, err)
			return
		}
	}
	writeJSON(writer, http.StatusOK, conversations)
}

func (server *Server) createConversation(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Local history is unavailable.")
		return
	}
	var input struct {
		Title                string  `json:"title"`
		ProjectID            *string `json:"project_id"`
		SourceConversationID *string `json:"source_conversation_id"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The conversation title is invalid.")
		return
	}
	var conversation persistence.Conversation
	var err error
	if input.ProjectID != nil && input.SourceConversationID != nil {
		writeProjectError(writer, persistence.ErrInvalidProject)
		return
	}
	projectID, sourceID := "", ""
	if input.ProjectID != nil {
		projectID = *input.ProjectID
	}
	if input.SourceConversationID != nil {
		sourceID = *input.SourceConversationID
		if sourceID == "" {
			writeProjectError(writer, persistence.ErrInvalidProject)
			return
		}
	}
	if input.ProjectID != nil || input.SourceConversationID != nil {
		if p, ok := server.chat.(chat.ProjectChat); ok {
			conversation, err = p.CreateProjectConversation(request.Context(), input.Title, projectID, sourceID)
		} else {
			err = persistence.ErrInvalidProject
		}
	} else {
		conversation, err = server.chat.CreateConversation(request.Context(), input.Title)
	}
	if err != nil {
		writeProjectError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, conversation)
}

func (server *Server) searchConversations(writer http.ResponseWriter, request *http.Request) {
	query := strings.TrimSpace(request.URL.Query().Get("q"))
	archived := false
	var err error
	if value := request.URL.Query().Get("archived"); value != "" {
		archived, err = strconv.ParseBool(value)
	}
	if err != nil || !utf8.ValidString(query) || utf8.RuneCountInString(query) > 256 {
		writeError(writer, http.StatusBadRequest, "validation", "Search requires up to 256 characters and a valid archive filter.")
		return
	}
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Local search is unavailable.")
		return
	}
	filter := persistence.ConversationSearchFilter{Kind: request.URL.Query().Get("kind")}
	if request.URL.Query().Has("project_id") {
		value := request.URL.Query().Get("project_id")
		filter.ProjectID = &value
	}
	if filter.Kind != "" && filter.Kind != "all" && filter.Kind != "chat" && filter.Kind != "debate" {
		writeError(writer, http.StatusBadRequest, "validation", "Choose a valid conversation type.")
		return
	}
	if value := request.URL.Query().Get("updated_after"); value != "" {
		cutoff, parseErr := time.Parse(time.RFC3339Nano, value)
		if parseErr != nil || cutoff.Year() < 1678 || cutoff.Year() > 2261 {
			writeError(writer, http.StatusBadRequest, "validation", "The activity cutoff must be a valid timestamp.")
			return
		}
		filter.UpdatedAfter = &cutoff
	}
	var results []persistence.ConversationSearchResult
	if filter.Kind == "chat" || filter.Kind == "debate" || filter.UpdatedAfter != nil || filter.ProjectID != nil {
		service, ok := server.chat.(persistence.FilteredConversationSearcher)
		if !ok {
			writeError(writer, http.StatusServiceUnavailable, "service_unavailable", "Filtered local history is unavailable.")
			return
		}
		results, err = service.SearchFilteredConversations(request.Context(), query, archived, filter)
	} else {
		results, err = server.chat.SearchConversations(request.Context(), query, archived)
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Local search is unavailable. Try a more specific phrase.")
		return
	}
	writeJSON(writer, http.StatusOK, results)
}

func (server *Server) getConversation(writer http.ResponseWriter, request *http.Request) {
	view, err := server.loadConversation(request)
	if err != nil {
		writeConversationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, conversationViewEnvelopeFor(view))
}

func (server *Server) getConversationMessages(writer http.ResponseWriter, request *http.Request) {
	view, err := server.loadConversation(request)
	if err != nil {
		writeConversationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, view.Messages)
}

func (server *Server) renameConversation(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Chat is unavailable.")
		return
	}
	var input struct {
		Title    *string `json:"title"`
		Pinned   *bool   `json:"pinned"`
		Archived *bool   `json:"archived"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The conversation update is invalid.")
		return
	}
	fields := 0
	if input.Title != nil {
		fields++
	}
	if input.Pinned != nil {
		fields++
	}
	if input.Archived != nil {
		fields++
	}
	if fields != 1 {
		writeError(writer, http.StatusBadRequest, "validation", "Update one conversation property at a time.")
		return
	}
	conversationID := request.PathValue("id")
	var updateErr error
	switch {
	case input.Title != nil:
		if strings.TrimSpace(*input.Title) == "" {
			writeError(writer, http.StatusBadRequest, "validation", "The conversation title is invalid.")
			return
		}
		updateErr = server.chat.RenameConversation(request.Context(), conversationID, *input.Title)
	case input.Pinned != nil:
		updateErr = server.chat.SetConversationPinned(request.Context(), conversationID, *input.Pinned)
	case input.Archived != nil:
		updateErr = server.chat.SetConversationArchived(request.Context(), conversationID, *input.Archived)
	}
	if updateErr != nil {
		writeConversationError(writer, updateErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) deleteConversation(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Chat is unavailable.")
		return
	}
	if err := server.chat.DeleteConversation(request.Context(), request.PathValue("id")); err != nil {
		writeConversationError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) clearChatData(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Chat history is unavailable.")
		return
	}
	if err := server.chat.ClearChatData(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Chat history could not be cleared.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) createGeneration(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Chat is unavailable.")
		return
	}
	var input struct {
		ExpectedProject  *persistence.ProjectExpectation `json:"expected_project"`
		ProjectID        *json.RawMessage                `json:"project_id"`
		EditOfBatchID    string                          `json:"edit_of_batch_id,omitempty"`
		ClientRequestID  string                          `json:"client_request_id"`
		Body             string                          `json:"body"`
		Attachments      []documents.Input               `json:"attachments"`
		WebSearchEnabled bool                            `json:"web_search_enabled"`
		WebSourceTokens  []string                        `json:"web_source_tokens"`
		ExpectedTargets  []chat.ExpectedGenerationTarget `json:"expected_targets"`
	}
	request.Body = http.MaxBytesReader(writer, request.Body, documents.MaxRequestBytes)
	if err := decodeJSON(request, &input); err != nil || strings.TrimSpace(input.ClientRequestID) == "" || strings.TrimSpace(input.Body) == "" || input.ProjectID != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The generation request is invalid.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(request)
	started, err := server.chat.StartGenerationBatch(request.Context(), chat.SendInput{ExpectedProject: input.ExpectedProject, EditOfBatchID: input.EditOfBatchID, ConversationID: request.PathValue("id"), ClientRequestID: input.ClientRequestID, Body: input.Body, Attachments: input.Attachments, WebSearchEnabled: input.WebSearchEnabled, WebSourceTokens: input.WebSourceTokens, WebSourceOwner: session.ID, ExpectedTargets: input.ExpectedTargets})
	if err != nil {
		if errors.Is(err, persistence.ErrProjectChanged) {
			current, readErr := server.chat.ReadConversation(request.Context(), request.PathValue("id"))
			if readErr != nil {
				writeGenerationError(writer, readErr)
				return
			}
			writeJSON(writer, 409, map[string]any{"error": map[string]any{"code": "project_context_changed", "message": "Project context changed. Review the refreshed context before sending again.", "request_id": "local", "details": map[string]any{"project_id": current.ProjectID, "project_revision": current.ProjectRevision, "membership_revision": current.MembershipRevision}}})
		} else {
			writeGenerationError(writer, err)
		}
		return
	}
	writeJSON(writer, http.StatusCreated, generationBatchEnvelopeFor(started.Batch))
}

func (server *Server) getGenerationBatch(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	batch, err := server.chat.GetGenerationBatch(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationBatchEnvelopeFor(batch))
}

func (server *Server) getGenerationBatchContext(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	messages, err := server.chat.GetGenerationBatchContext(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	if request.URL.Query().Get("format") == "project-v1" {
		batch, e := server.chat.GetGenerationBatch(request.Context(), request.PathValue("id"))
		if e != nil {
			writeGenerationError(writer, e)
			return
		}
		writeJSON(writer, 200, map[string]any{"history": messages, "project_context": batch.ProjectContext})
		return
	}
	writeJSON(writer, http.StatusOK, messages)
}

func (server *Server) generationBatchEvents(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	afterEventID := request.Header.Get("Last-Event-ID")
	if afterEventID == "" {
		afterEventID = request.URL.Query().Get("after")
	}
	events, err := server.chat.SubscribeGenerationBatch(request.Context(), request.PathValue("id"), afterEventID)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	server.writeGenerationEvents(writer, events)
}

func (server *Server) cancelGenerationBatch(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	batch, err := server.chat.CancelGenerationBatch(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationBatchEnvelopeFor(batch))
}

func (server *Server) retryGenerationTarget(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	var input struct {
		ClientRequestID string `json:"client_request_id"`
	}
	if err := decodeJSON(request, &input); err != nil || strings.TrimSpace(input.ClientRequestID) == "" {
		writeError(writer, http.StatusBadRequest, "validation", "The retry request is invalid.")
		return
	}
	started, err := server.chat.RetryGenerationTarget(request.Context(), request.PathValue("id"), input.ClientRequestID)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, generationEnvelopeFor(started.Generation))
}

func (server *Server) selectGenerationAnswer(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	if err := server.chat.SelectGenerationAnswer(request.Context(), request.PathValue("id")); err != nil {
		writeGenerationError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) skipGenerationBatchContext(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	if err := server.chat.SkipGenerationBatchContext(request.Context(), request.PathValue("id")); err != nil {
		writeGenerationError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) getGeneration(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	generation, err := server.chat.GetGeneration(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationEnvelopeFor(generation))
}

func (server *Server) generationEvents(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	afterEventID := request.Header.Get("Last-Event-ID")
	if afterEventID == "" {
		afterEventID = request.URL.Query().Get("after")
	}
	events, err := server.chat.SubscribeGeneration(request.Context(), request.PathValue("id"), afterEventID)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	server.writeGenerationEvents(writer, events)
}

func (server *Server) writeGenerationEvents(writer http.ResponseWriter, events <-chan chat.GenerationEvent) {
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.Header().Set("Connection", "keep-alive")
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "internal_error", "The event stream is unavailable.")
		return
	}
	for event := range events {
		payload, err := json.Marshal(generationEventEnvelopeFor(event))
		if err != nil {
			return
		}
		if _, err := fmt.Fprintf(writer, "id: %s\nevent: %s\ndata: %s\n\n", event.EventID, event.Type, payload); err != nil {
			return
		}
		flusher.Flush()
	}
}

func (server *Server) cancelGeneration(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	generation, err := server.chat.CancelGeneration(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationEnvelopeFor(generation))
}

func (server *Server) secureGenerationEnvironment(writer http.ResponseWriter, request *http.Request) {
	server.advanceSecureGeneration(writer, request, server.chat.MarkSecureGenerationVerifyingEnvironment)
}

func (server *Server) secureGenerationStreaming(writer http.ResponseWriter, request *http.Request) {
	server.advanceSecureGeneration(writer, request, server.chat.MarkSecureGenerationStreaming)
}

func (server *Server) secureGenerationResponse(writer http.ResponseWriter, request *http.Request) {
	server.advanceSecureGeneration(writer, request, server.chat.MarkSecureGenerationVerifyingResponse)
}

func (server *Server) advanceSecureGeneration(writer http.ResponseWriter, request *http.Request, advance func(context.Context, string) (persistence.Generation, error)) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	generation, err := advance(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationEnvelopeFor(generation))
}

func (server *Server) secureGenerationSettle(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusNotFound, "not_found", "The requested API route does not exist.")
		return
	}
	var input struct {
		Body         string                         `json:"body"`
		Reasoning    string                         `json:"reasoning,omitempty"`
		Metrics      *persistence.GenerationMetrics `json:"metrics,omitempty"`
		Verification struct {
			Status           persistence.VerificationStatus    `json:"status"`
			CompletionID     string                            `json:"completion_id"`
			VerifiedAt       *time.Time                        `json:"verified_at"`
			SignatureKind    string                            `json:"signature_kind"`
			SigningAddress   string                            `json:"signing_address"`
			SigningAlgorithm string                            `json:"signing_algorithm"`
			SignedMessage    string                            `json:"signed_message"`
			Signature        string                            `json:"signature"`
			SignatureDigest  string                            `json:"signature_digest"`
			EvidenceSummary  string                            `json:"evidence_summary"`
			FailureCode      string                            `json:"failure_code"`
			Evidence         *persistence.VerificationEvidence `json:"evidence"`
			Lanes            *persistence.VerificationLanes    `json:"lanes"`
		} `json:"verification"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The secure generation settlement is invalid.")
		return
	}
	generation, err := server.chat.SettleSecureGeneration(request.Context(), persistence.SecureGenerationSettlementInput{GenerationID: request.PathValue("id"), Body: input.Body, Reasoning: input.Reasoning, Metrics: input.Metrics, Verification: persistence.GenerationVerification{Status: input.Verification.Status, CompletionID: input.Verification.CompletionID, VerifiedAt: input.Verification.VerifiedAt, SignatureKind: input.Verification.SignatureKind, SigningAddress: input.Verification.SigningAddress, SigningAlgorithm: input.Verification.SigningAlgorithm, SignedMessage: input.Verification.SignedMessage, Signature: input.Verification.Signature, SignatureDigest: input.Verification.SignatureDigest, EvidenceSummary: input.Verification.EvidenceSummary, FailureCode: input.Verification.FailureCode, Evidence: input.Verification.Evidence, Lanes: input.Verification.Lanes}})
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, generationEnvelopeFor(generation))
}

type providerSnapshotEnvelope struct {
	ProviderKind      string `json:"provider_kind,omitempty"`
	ProviderID        string `json:"provider_id"`
	ProviderName      string `json:"provider_name"`
	ModelID           string `json:"model_id"`
	RuntimeLocation   string `json:"runtime_location"`
	Destination       string `json:"destination"`
	TransportSecurity string `json:"transport_security"`
	PrivacyNotice     string `json:"privacy_notice"`
	PrivacyMode       string `json:"privacy_mode,omitempty"`
}

type generationConfigurationSnapshotEnvelope struct {
	WebSearch    *websearch.Policy `json:"web_search,omitempty"`
	SystemPrompt string            `json:"system_prompt"`
	Temperature  *float64          `json:"temperature"`
	TopP         *float64          `json:"top_p"`
	MaxTokens    *int              `json:"max_tokens"`
}

type generationVerificationEnvelope struct {
	Status           persistence.VerificationStatus    `json:"status"`
	CompletionID     string                            `json:"completion_id,omitempty"`
	VerifiedAt       *time.Time                        `json:"verified_at,omitempty"`
	SignatureKind    string                            `json:"signature_kind,omitempty"`
	SigningAddress   string                            `json:"signing_address,omitempty"`
	SigningAlgorithm string                            `json:"signing_algorithm,omitempty"`
	SignedMessage    string                            `json:"signed_message,omitempty"`
	Signature        string                            `json:"signature,omitempty"`
	SignatureDigest  string                            `json:"signature_digest,omitempty"`
	EvidenceSummary  string                            `json:"evidence_summary,omitempty"`
	FailureCode      string                            `json:"failure_code,omitempty"`
	Evidence         *persistence.VerificationEvidence `json:"evidence,omitempty"`
	Lanes            *persistence.VerificationLanes    `json:"lanes,omitempty"`
}

type generationEnvelope struct {
	WebSearch             *persistence.WebSearchInfo              `json:"web_search,omitempty"`
	Metrics               *persistence.GenerationMetrics          `json:"metrics,omitempty"`
	ID                    string                                  `json:"id"`
	ConversationID        string                                  `json:"conversation_id"`
	ClientRequestID       string                                  `json:"client_request_id"`
	UserMessageID         string                                  `json:"user_message_id"`
	State                 persistence.GenerationState             `json:"state"`
	Snapshot              providerSnapshotEnvelope                `json:"snapshot"`
	ConfigurationSnapshot generationConfigurationSnapshotEnvelope `json:"configuration_snapshot"`
	Verification          generationVerificationEnvelope          `json:"verification"`
	AssistantMessageID    string                                  `json:"assistant_message_id,omitempty"`
	ErrorCode             string                                  `json:"error_code,omitempty"`
	ErrorMessage          string                                  `json:"error_message,omitempty"`
	EventsURL             string                                  `json:"events_url"`
	CreatedAt             time.Time                               `json:"created_at"`
	UpdatedAt             time.Time                               `json:"updated_at"`
}

type generationEventEnvelope struct {
	WebActivity    string                    `json:"web_activity,omitempty"`
	Reset          bool                      `json:"reset,omitempty"`
	EventID        string                    `json:"event_id"`
	BatchID        string                    `json:"batch_id,omitempty"`
	TargetID       string                    `json:"target_id,omitempty"`
	GenerationID   string                    `json:"generation_id"`
	Type           chat.EventType            `json:"type"`
	Delta          string                    `json:"delta,omitempty"`
	ReasoningDelta string                    `json:"reasoning_delta,omitempty"`
	ErrorCode      string                    `json:"error_code,omitempty"`
	ErrorMessage   string                    `json:"error_message,omitempty"`
	Snapshot       *providerSnapshotEnvelope `json:"snapshot,omitempty"`
}

type generationTargetAttemptEnvelope struct {
	WebSearch             *persistence.WebSearchInfo              `json:"web_search,omitempty"`
	Metrics               *persistence.GenerationMetrics          `json:"metrics,omitempty"`
	CreatedAt             time.Time                               `json:"created_at"`
	UpdatedAt             time.Time                               `json:"updated_at"`
	ID                    string                                  `json:"id"`
	State                 persistence.GenerationState             `json:"state"`
	Snapshot              providerSnapshotEnvelope                `json:"snapshot"`
	ConfigurationSnapshot generationConfigurationSnapshotEnvelope `json:"configuration_snapshot"`
	Verification          generationVerificationEnvelope          `json:"verification"`
	AssistantMessageID    string                                  `json:"assistant_message_id,omitempty"`
	ErrorCode             string                                  `json:"error_code,omitempty"`
	ErrorMessage          string                                  `json:"error_message,omitempty"`
}

type conversationViewEnvelope struct {
	ProjectContexts map[string]*persistence.ProjectContext `json:"project_contexts,omitempty"`
	Branch          *persistence.ConversationBranch        `json:"branch,omitempty"`
	persistence.Conversation
	Messages              []persistence.Message     `json:"messages"`
	ActiveGenerationBatch *generationBatchEnvelope  `json:"active_generation_batch,omitempty"`
	GenerationBatches     []generationBatchEnvelope `json:"generation_batches"`
}

type generationTargetEnvelope struct {
	ID         string                          `json:"id"`
	ProviderID string                          `json:"provider_id"`
	ModelID    string                          `json:"model_id"`
	Position   int                             `json:"position"`
	Generation generationTargetAttemptEnvelope `json:"generation"`
}

type generationBatchEnvelope struct {
	ProjectContextID     string                           `json:"project_context_id,omitempty"`
	ProjectContext       *persistence.ProjectContext      `json:"project_context,omitempty"`
	WebSearch            *websearch.Policy                `json:"web_search,omitempty"`
	ID                   string                           `json:"id"`
	ConversationID       string                           `json:"conversation_id"`
	ClientRequestID      string                           `json:"client_request_id"`
	UserMessageID        string                           `json:"user_message_id,omitempty"`
	InputContent         string                           `json:"input_content,omitempty"`
	Attachments          []documents.Snapshot             `json:"attachments,omitempty"`
	State                persistence.GenerationBatchState `json:"state"`
	Targets              []generationTargetEnvelope       `json:"targets"`
	EventsURL            string                           `json:"events_url"`
	SelectedGenerationID string                           `json:"selected_generation_id,omitempty"`
	SelectedAnswer       *persistence.SelectedAnswer      `json:"selected_answer,omitempty"`
	ContextSkipped       bool                             `json:"context_skipped,omitempty"`
	ContextFrozen        bool                             `json:"context_frozen,omitempty"`
	CreatedAt            time.Time                        `json:"created_at"`
	UpdatedAt            time.Time                        `json:"updated_at"`
}

func generationEnvelopeFor(generation persistence.Generation) generationEnvelope {
	return generationEnvelope{
		ID: generation.ID, ConversationID: generation.ConversationID, ClientRequestID: generation.ClientRequestID,
		UserMessageID: generation.UserMessageID, State: generation.State, Snapshot: providerSnapshotEnvelopeFor(generation.Snapshot), ConfigurationSnapshot: generationConfigurationSnapshotEnvelopeFor(generation.ConfigurationSnapshot),
		WebSearch: generation.WebSearch, Metrics: generation.Metrics, Verification: generationVerificationEnvelopeFor(generation.Verification),
		AssistantMessageID: generation.AssistantMessageID, ErrorCode: generation.ErrorCode, ErrorMessage: generation.ErrorMessage,
		EventsURL: "/api/generations/" + generation.ID + "/events", CreatedAt: generation.CreatedAt, UpdatedAt: generation.UpdatedAt,
	}
}

func conversationViewEnvelopeFor(view persistence.ConversationView) conversationViewEnvelope {
	result := conversationViewEnvelope{Branch: view.Branch, Conversation: view.Conversation, Messages: view.Messages, GenerationBatches: make([]generationBatchEnvelope, 0, len(view.GenerationBatches))}
	result.ProjectContexts = make(map[string]*persistence.ProjectContext)
	reference := func(batch persistence.GenerationBatch) generationBatchEnvelope {
		envelope := generationBatchEnvelopeFor(batch)
		if p := batch.ProjectContext; p != nil {
			key := p.Hash
			if key == "" {
				raw, _ := json.Marshal(p)
				sum := sha256.Sum256(raw)
				key = hex.EncodeToString(sum[:])
			}
			result.ProjectContexts[key] = p
			envelope.ProjectContext = nil
			envelope.ProjectContextID = key
		}
		return envelope
	}
	if view.ActiveGenerationBatch != nil {
		batch := reference(*view.ActiveGenerationBatch)
		result.ActiveGenerationBatch = &batch
	}
	for _, batch := range view.GenerationBatches {
		result.GenerationBatches = append(result.GenerationBatches, reference(batch))
	}
	return result
}

func generationBatchEnvelopeFor(batch persistence.GenerationBatch) generationBatchEnvelope {
	targets := make([]generationTargetEnvelope, 0, len(batch.Targets))
	for _, target := range batch.Targets {
		generation := target.Generation
		targets = append(targets, generationTargetEnvelope{
			ID: target.ID, ProviderID: target.ProviderID, ModelID: target.ModelID, Position: target.Position,
			Generation: generationTargetAttemptEnvelope{
				CreatedAt: generation.CreatedAt, UpdatedAt: generation.UpdatedAt,
				ID: generation.ID, State: generation.State, Snapshot: providerSnapshotEnvelopeFor(generation.Snapshot), ConfigurationSnapshot: generationConfigurationSnapshotEnvelopeFor(generation.ConfigurationSnapshot),
				WebSearch: generation.WebSearch, Metrics: generation.Metrics, Verification: generationVerificationEnvelopeFor(generation.Verification),
				AssistantMessageID: generation.AssistantMessageID, ErrorCode: generation.ErrorCode, ErrorMessage: generation.ErrorMessage,
			},
		})
	}
	return generationBatchEnvelope{
		ProjectContext: batch.ProjectContext, InputContent: batch.InputContent, Attachments: batch.Attachments, WebSearch: batch.WebSearch,
		ID: batch.ID, ConversationID: batch.ConversationID, ClientRequestID: batch.ClientRequestID, UserMessageID: batch.UserMessageID,
		State: batch.State, Targets: targets, EventsURL: "/api/generation-batches/" + batch.ID + "/events",
		SelectedGenerationID: batch.SelectedGenerationID, SelectedAnswer: batch.SelectedAnswer, ContextSkipped: batch.ContextSkipped, ContextFrozen: batch.ContextFrozen, CreatedAt: batch.CreatedAt, UpdatedAt: batch.UpdatedAt,
	}
}

func generationVerificationEnvelopeFor(verification persistence.GenerationVerification) generationVerificationEnvelope {
	if verification.Status == "" {
		verification.Status = persistence.VerificationUnsupported
	}
	return generationVerificationEnvelope{Status: verification.Status, CompletionID: verification.CompletionID, VerifiedAt: verification.VerifiedAt, SignatureKind: verification.SignatureKind, SigningAddress: verification.SigningAddress, SigningAlgorithm: verification.SigningAlgorithm, SignedMessage: verification.SignedMessage, Signature: verification.Signature, SignatureDigest: verification.SignatureDigest, EvidenceSummary: verification.EvidenceSummary, FailureCode: verification.FailureCode, Evidence: verification.Evidence, Lanes: verification.Lanes}
}

func generationEventEnvelopeFor(event chat.GenerationEvent) generationEventEnvelope {
	result := generationEventEnvelope{
		EventID: event.EventID, BatchID: event.BatchID, TargetID: event.TargetID, GenerationID: event.GenerationID, Type: event.Type,
		WebActivity: event.WebActivity, Reset: event.Reset, Delta: event.Delta, ReasoningDelta: event.ReasoningDelta, ErrorCode: event.ErrorCode, ErrorMessage: event.ErrorMessage,
	}
	if event.Snapshot != nil {
		snapshot := providerSnapshotEnvelopeFor(*event.Snapshot)
		result.Snapshot = &snapshot
	}
	return result
}

func providerSnapshotEnvelopeFor(snapshot persistence.ProviderSnapshot) providerSnapshotEnvelope {
	return providerSnapshotEnvelope{
		ProviderKind: snapshot.ProviderKind, ProviderID: snapshot.ProviderID, ProviderName: snapshot.ProviderName, ModelID: snapshot.ModelID,
		RuntimeLocation: snapshot.RuntimeLocation, Destination: snapshot.Destination,
		TransportSecurity: snapshot.TransportSecurity, PrivacyNotice: snapshot.PrivacyNotice,
		PrivacyMode: snapshot.PrivacyMode,
	}
}

func generationConfigurationSnapshotEnvelopeFor(snapshot persistence.GenerationConfigurationSnapshot) generationConfigurationSnapshotEnvelope {
	return generationConfigurationSnapshotEnvelope{
		WebSearch: snapshot.WebSearch, SystemPrompt: snapshot.SystemPrompt, Temperature: snapshot.Temperature, TopP: snapshot.TopP, MaxTokens: snapshot.MaxTokens,
	}
}

func (server *Server) listProviderProfiles(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	profiles, err := server.providerSetup.List(request.Context())
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, profiles)
}

func (server *Server) getProviderProfile(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	profile, err := server.providerSetup.Get(request.Context(), request.PathValue("id"))
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, profile)
}

func (server *Server) createProviderProfile(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	var input providerconfig.ProfileInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The Provider Profile is invalid.")
		return
	}
	profile, err := server.providerSetup.Configure(request.Context(), input)
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, profile)
}

func (server *Server) updateProviderProfile(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	var input providerconfig.ProfileInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The Provider Profile is invalid.")
		return
	}
	input.ID = request.PathValue("id")
	profile, err := server.providerSetup.Configure(request.Context(), input)
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, profile)
}

func (server *Server) deleteProviderProfile(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	if err := server.providerSetup.Delete(request.Context(), request.PathValue("id")); err != nil {
		writeProviderError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) deleteProviderKey(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	if err := server.providerSetup.DeleteKey(request.Context(), request.PathValue("id")); err != nil {
		writeProviderError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) testProviderConnection(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	var input providerconfig.ProfileInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "validation", "The Provider connection details are invalid.")
		return
	}
	result, err := server.providerSetup.Validate(request.Context(), input)
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) discoverProviderModels(writer http.ResponseWriter, request *http.Request) {
	if server.providerSetup == nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
		return
	}
	result, err := server.providerSetup.Discover(request.Context(), providerconfig.ProfileInput{ID: request.PathValue("id")})
	if err != nil {
		writeProviderError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) loadConversation(request *http.Request) (persistence.ConversationView, error) {
	if server.chat == nil {
		return persistence.ConversationView{}, errors.New("history unavailable")
	}
	return server.chat.ReadConversation(request.Context(), request.PathValue("id"))
}

func writeConversationError(writer http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "not_found", "The requested conversation does not exist.")
		return
	}
	writeError(writer, http.StatusInternalServerError, "internal_error", "Local history is unavailable.")
}

func writeGenerationError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, websearch.ErrUnavailable):
		writeError(writer, http.StatusConflict, "web_search_unconfigured", "Configure a search Provider in Settings before enabling Web search.")
	case errors.Is(err, chat.ErrDebateConversation):
		writeError(writer, http.StatusConflict, "debate_conversation", "Use the debate controls for this conversation.")
	case errors.Is(err, persistence.ErrProjectChanged):
		writeError(writer, 409, "project_context_changed", "Project context changed. Refresh and review your draft.")
	case errors.Is(err, documents.ErrContextLimit):
		writeError(writer, 400, "context_limit", err.Error())
	case errors.Is(err, documents.ErrInvalidDocument):
		writeError(writer, http.StatusBadRequest, "invalid_attachment", err.Error())
	case errors.Is(err, sql.ErrNoRows):
		writeError(writer, http.StatusNotFound, "not_found", "The requested Generation does not exist.")
	case errors.Is(err, chat.ErrGenerationInProgress):
		writeError(writer, http.StatusConflict, "generation_in_progress", "Another Generation is already in progress.")
	case errors.Is(err, chat.ErrGenerationBatchInProgress):
		writeError(writer, http.StatusConflict, "generation_batch_in_progress", "Another Generation Batch is already in progress.")
	case errors.Is(err, persistence.ErrInvalidBranch):
		writeError(writer, http.StatusConflict, "invalid_branch", "The source turn is unavailable for editing. Refresh the conversation and try again.")
	case errors.Is(err, persistence.ErrContextDispositionRequired):
		writeError(writer, http.StatusConflict, "context_disposition_required", "Select an answer or continue without an answer before starting the next Generation Batch.")
	case errors.Is(err, persistence.ErrContextDispositionFrozen):
		writeError(writer, http.StatusConflict, "context_disposition_frozen", "A later Generation Batch already captured this answer choice.")
	case errors.Is(err, chat.ErrGenerationSelectionChanged), errors.Is(err, persistence.ErrProviderProfileChanged):
		writeError(writer, http.StatusConflict, "generation_selection_changed", "The selected connection changed. Reload it and send again.")
	case errors.Is(err, chat.ErrPrivateTEEUnavailable):
		writeError(writer, http.StatusConflict, "private_tee_unavailable", "Private TEE is no longer available for this model.")
	case errors.Is(err, chat.ErrProviderSelectionRequired):
		writeError(writer, http.StatusUnprocessableEntity, "provider_selection_required", "Select a configured Provider and model before starting a Generation.")
	case errors.Is(err, provider.ErrModelUnavailable):
		writeError(writer, http.StatusBadRequest, "validation", "The selected Provider model is unavailable.")
	case errors.Is(err, providerconfig.ErrUnconfigured):
		writeError(writer, http.StatusUnprocessableEntity, "provider_unconfigured", "This Provider Profile has no configured Key.")
	case errors.Is(err, provider.ErrAuthenticationFailed):
		writeError(writer, http.StatusUnauthorized, "authentication_failed", "The Provider rejected the configured Key.")
	case errors.Is(err, provider.ErrRateLimited):
		writeError(writer, http.StatusTooManyRequests, "rate_limited", "The Provider rate limited the generation request.")
	case errors.Is(err, provider.ErrProviderUnavailable):
		writeError(writer, http.StatusBadGateway, "provider_unavailable", "The Provider could not be reached.")
	case errors.Is(err, provider.ErrProtocol):
		writeError(writer, http.StatusBadGateway, "protocol_error", "The Provider returned an invalid response.")
	default:
		writeError(writer, http.StatusInternalServerError, "internal_error", "The Generation could not be started.")
	}
}

func writeProviderError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeError(writer, http.StatusNotFound, "not_found", "The requested Provider Profile does not exist.")
	case errors.Is(err, persistence.ErrProviderProfileChanged):
		writeError(writer, http.StatusConflict, "provider_profile_changed", "The Provider Profile changed. Reload it and try again.")
	case errors.Is(err, providerconfig.ErrDestinationChanged):
		writeError(writer, http.StatusBadRequest, "provider_destination_changed", "Enter a Provider Key for the changed connection.")
	case errors.Is(err, providerconfig.ErrUnconfigured):
		writeError(writer, http.StatusUnprocessableEntity, "provider_unconfigured", "This Provider Profile has no configured Key.")
	case errors.Is(err, provider.ErrAuthenticationFailed):
		writeError(writer, http.StatusUnauthorized, "authentication_failed", "The Provider rejected the configured Key.")
	case errors.Is(err, provider.ErrRateLimited):
		writeError(writer, http.StatusTooManyRequests, "rate_limited", "The Provider rate limited the validation request.")
	case errors.Is(err, provider.ErrProviderUnavailable):
		writeError(writer, http.StatusBadGateway, "provider_unavailable", "The Provider could not be reached.")
	case errors.Is(err, provider.ErrProtocol):
		writeError(writer, http.StatusBadGateway, "protocol_error", "The Provider returned an invalid response.")
	case errors.Is(err, provider.ErrInvalidEndpoint), errors.Is(err, provider.ErrInsecureEndpoint), errors.Is(err, provider.ErrInvalidAuth), errors.Is(err, provider.ErrInvalidProfile), errors.Is(err, provider.ErrModelUnavailable), errors.Is(err, providerconfig.ErrValidationFailed):
		writeError(writer, http.StatusBadRequest, "validation", "The Provider connection details could not be validated.")
	default:
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider configuration is unavailable.")
	}
}

func decodeJSON(request *http.Request, target any) error {
	decoder := json.NewDecoder(request.Body)
	return decoder.Decode(target)
}

func (server *Server) writeSecurityError(writer http.ResponseWriter, _ *http.Request, err error) {
	switch {
	case errors.Is(err, localsecurity.ErrInvalidHost):
		writeError(writer, http.StatusBadRequest, "invalid_host", "The Local Service only accepts loopback hosts.")
	case errors.Is(err, localsecurity.ErrInvalidOrigin):
		writeError(writer, http.StatusForbidden, "invalid_origin", "The request origin is not authorized.")
	case errors.Is(err, localsecurity.ErrInvalidCSRF):
		writeError(writer, http.StatusForbidden, "invalid_csrf", "The request is missing a valid CSRF token.")
	case errors.Is(err, localsecurity.ErrInvalidControlToken):
		writeError(writer, http.StatusUnauthorized, "invalid_control_token", "The Launcher control token is invalid.")
	default:
		writeError(writer, http.StatusUnauthorized, "invalid_session", "A valid browser session is required.")
	}
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, ErrorEnvelope{Error: APIError{
		Code:      code,
		Message:   message,
		RequestID: "local",
	}})
}
