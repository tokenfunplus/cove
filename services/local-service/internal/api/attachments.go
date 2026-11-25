package api

import (
	"encoding/json"
	"mime"
	"net/http"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/interactive"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func (server *Server) previewGenerationContext(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	if server.chat == nil {
		writeError(writer, http.StatusServiceUnavailable, "unavailable", "Chat is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, documents.MaxRequestBytes)
	var input struct {
		Card            *interactive.Submission `json:"interaction"`
		Interactive     bool                    `json:"interactive"`
		ProjectID       *json.RawMessage        `json:"project_id"`
		Body            string                  `json:"body"`
		Attachments     []documents.Input       `json:"attachments"`
		WebSourceTokens []string                `json:"web_source_tokens"`
	}
	if err := decodeJSON(request, &input); err != nil || input.ProjectID != nil {
		writeError(writer, http.StatusBadRequest, "invalid_attachment", "The context preview request is invalid or too large.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(request)
	send := chat.SendInput{Card: input.Card, Interactive: input.Interactive, ConversationID: request.PathValue("id"), Body: strings.TrimSpace(input.Body), Attachments: input.Attachments, WebSourceTokens: input.WebSourceTokens, WebSourceOwner: session.ID}
	if request.URL.Query().Get("format") == "project-v1" {
		if p, ok := server.chat.(chat.ProjectChat); ok {
			preview, e := p.PreviewProjectGenerationContext(request.Context(), send)
			if e != nil {
				writeProjectError(writer, e)
				return
			}
			writeJSON(writer, 200, previewEnvelope(preview.Messages, preview.Project, preview.Expected))
			return
		}
	}
	messages, err := server.chat.PreviewGenerationContext(request.Context(), send)
	if err != nil {
		writeProjectError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, messages)
}

func (server *Server) prepareWebSource(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusServiceUnavailable, "unavailable", "Chat is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
	var input struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(request, &input); err != nil || len(input.URL) > 8192 {
		writeError(writer, http.StatusBadRequest, "validation", "The webpage request is invalid or too large.")
		return
	}
	session, _ := localsecurity.SessionFromRequest(request)
	source, err := server.chat.PrepareWebSource(request.Context(), session.ID, input.URL)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, source)
}

func (server *Server) releaseWebSource(writer http.ResponseWriter, request *http.Request) {
	if server.chat != nil {
		session, _ := localsecurity.SessionFromRequest(request)
		server.chat.ReleaseWebSource(request.Context(), session.ID, request.PathValue("token"))
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) previewAttachment(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusServiceUnavailable, "unavailable", "Chat is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 6<<20)
	var input documents.Input
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_attachment", "The attachment is invalid or exceeds 4 MiB.")
		return
	}
	snapshot, err := server.chat.PreviewAttachment(request.Context(), input)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (server *Server) downloadAttachment(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusServiceUnavailable, "unavailable", "Chat is unavailable.")
		return
	}
	input, err := server.chat.ReadAttachment(request.Context(), request.PathValue("id"), request.PathValue("document"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Content-Type", "application/octet-stream")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": input.Name}))
	_, _ = writer.Write(input.Data)
}
