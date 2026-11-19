package api

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
)

func (server *Server) debateChat(writer http.ResponseWriter) chat.Debates {
	service, ok := server.chat.(chat.Debates)
	if !ok {
		writeError(writer, http.StatusServiceUnavailable, "service_unavailable", "Debate mode is unavailable.")
		return nil
	}
	return service
}

func writeDebateError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, chat.ErrInvalidDebate):
		writeError(writer, http.StatusBadRequest, "validation", "Choose a topic, two to four distinct model targets, valid roles, and ground rules.")
	case errors.Is(err, chat.ErrDebateState):
		writeError(writer, http.StatusConflict, "debate_state", "This action is unavailable in the current debate state. Refresh and try again.")
	case errors.Is(err, sql.ErrNoRows):
		writeError(writer, http.StatusNotFound, "not_found", "The requested debate does not exist.")
	default:
		writeGenerationError(writer, err)
	}
}

func (server *Server) createDebate(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 64<<10)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input chat.StartDebateInput
	if decodeJSON(request, &input) != nil {
		writeError(writer, http.StatusBadRequest, "validation", "Invalid debate request.")
		return
	}
	result, err := service.StartDebate(request.Context(), input)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (server *Server) getDebate(writer http.ResponseWriter, request *http.Request) {
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var before int64
	if raw := request.URL.Query().Get("before"); raw != "" {
		var err error
		before, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || before < 0 {
			writeError(writer, http.StatusBadRequest, "validation", "Invalid turn cursor.")
			return
		}
	}
	result, err := service.ReadDebate(request.Context(), request.PathValue("id"), before)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) controlDebate(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 1<<10)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input struct {
		Action string `json:"action"`
	}
	if decodeJSON(request, &input) != nil {
		writeError(writer, http.StatusBadRequest, "validation", "Invalid debate control.")
		return
	}
	result, err := service.ControlDebate(request.Context(), request.PathValue("id"), input.Action)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) getDebateTurn(writer http.ResponseWriter, request *http.Request) {
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	turn, err := service.ReadDebateTurn(request.Context(), request.PathValue("id"), request.PathValue("turn"))
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, turn)
}

func (server *Server) claimDebateBrowserTurn(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 1024)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input struct {
		ClaimID string `json:"claim_id"`
	}
	if decodeJSON(request, &input) != nil {
		writeDebateError(writer, chat.ErrInvalidDebate)
		return
	}
	result, err := service.ClaimDebateBrowserTurn(request.Context(), request.PathValue("id"), request.PathValue("turn"), input.ClaimID)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) progressDebateBrowserTurn(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 2<<20)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input chat.DebateBrowserProgress
	if decodeJSON(request, &input) != nil {
		writeDebateError(writer, chat.ErrInvalidDebate)
		return
	}
	if err := service.ProgressDebateBrowserTurn(request.Context(), request.PathValue("id"), request.PathValue("turn"), input); err != nil {
		writeDebateError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) settleDebateBrowserTurn(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 8<<20)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input chat.DebateBrowserResult
	if decodeJSON(request, &input) != nil {
		writeDebateError(writer, chat.ErrInvalidDebate)
		return
	}
	result, err := service.SettleDebateBrowserTurn(request.Context(), request.PathValue("id"), request.PathValue("turn"), input)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) updateDebateRules(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 32<<10)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var rules persistence.DebateRules
	if decodeJSON(request, &rules) != nil {
		writeError(writer, http.StatusBadRequest, "validation", "Invalid debate rules.")
		return
	}
	result, err := service.UpdateDebateRules(request.Context(), request.PathValue("id"), rules)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) addDebateIntervention(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 32<<10)
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	var input persistence.DebateIntervention
	if decodeJSON(request, &input) != nil {
		writeError(writer, http.StatusBadRequest, "validation", "Invalid intervention.")
		return
	}
	result, err := service.AddDebateIntervention(request.Context(), request.PathValue("id"), input)
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

// Notifications are deliberately coalesced; every connection starts with a full
// read reconciliation. No subscriber can block Provider workers or scheduling.
func (server *Server) debateEvents(writer http.ResponseWriter, request *http.Request) {
	service := server.debateChat(writer)
	if service == nil {
		return
	}
	updates, err := service.SubscribeDebate(request.Context(), request.PathValue("id"))
	if err != nil {
		writeDebateError(writer, err)
		return
	}
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Streaming is unavailable.")
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(writer)
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case _, open := <-updates:
			if !open {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err = fmt.Fprint(writer, "event: refresh\ndata: {}\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err = fmt.Fprint(writer, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-request.Context().Done():
			return
		}
	}
}
