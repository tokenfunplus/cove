package api

import (
	"mime"
	"net/http"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"

	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
)

func (server *Server) previewGenerationContext(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, http.StatusServiceUnavailable, "unavailable", "Chat is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, documents.MaxRequestBytes)
	var input struct {
		Body        string            `json:"body"`
		Attachments []documents.Input `json:"attachments"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_attachment", "The context preview request is invalid or too large.")
		return
	}
	messages, err := server.chat.PreviewGenerationContext(request.Context(), chat.SendInput{ConversationID: request.PathValue("id"), Body: strings.TrimSpace(input.Body), Attachments: input.Attachments})
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, messages)
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
