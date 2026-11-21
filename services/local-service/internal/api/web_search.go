package api

import (
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/websearch"
)

func (server *Server) webSearchSettings(writer http.ResponseWriter, request *http.Request) {
	if server.searchService == nil {
		writeError(writer, 503, "unavailable", "Web search settings are unavailable.")
		return
	}
	settings, err := server.searchService.Settings(request.Context())
	if err != nil {
		writeError(writer, 500, "unavailable", "Web search settings could not be loaded.")
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, 200, settings)
}

func (server *Server) saveWebSearchSettings(writer http.ResponseWriter, request *http.Request) {
	if server.searchService == nil {
		writeError(writer, 503, "unavailable", "Web search settings are unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
	var input struct {
		Policy websearch.Policy `json:"policy"`
		APIKey string           `json:"api_key"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, 400, "validation", "The Web search configuration is invalid.")
		return
	}
	if err := server.searchService.Save(request.Context(), input.Policy, input.APIKey); err != nil {
		writeError(writer, 400, "web_search_configuration", err.Error())
		return
	}
	server.webSearchSettings(writer, request)
}

func (server *Server) deleteWebSearchProvider(writer http.ResponseWriter, request *http.Request) {
	if server.searchService == nil {
		writeError(writer, 503, "unavailable", "Web search settings are unavailable.")
		return
	}
	if err := server.searchService.Delete(request.Context(), request.PathValue("provider")); err != nil {
		writeError(writer, 400, "web_search_configuration", "The search Provider key could not be removed.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) executeWebTool(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, 503, "unavailable", "Chat is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 2<<20)
	var input chat.WebToolInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, 400, "validation", "The web tool request is invalid or too large.")
		return
	}
	result, err := server.chat.ExecuteWebTool(request.Context(), request.PathValue("id"), input)
	if err != nil {
		writeError(writer, 409, "web_tool_failed", err.Error())
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, 200, result)
}

func (server *Server) getWebTool(writer http.ResponseWriter, request *http.Request) {
	if server.chat == nil {
		writeError(writer, 503, "unavailable", "Chat is unavailable.")
		return
	}
	generation, err := server.chat.GetGeneration(request.Context(), request.PathValue("id"))
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	if generation.ConfigurationSnapshot.WebSearch == nil {
		writeError(writer, 404, "not_found", "This response has no Web search session.")
		return
	}
	run, err := server.chat.GetWebSearchRun(request.Context(), generation.ID)
	if err != nil {
		writeGenerationError(writer, err)
		return
	}
	for _, record := range run.Records {
		if record.ID == request.PathValue("call") {
			writer.Header().Set("Cache-Control", "no-store")
			status := record.Status
			if status == "running" && (generation.State == "stopped" || generation.State == "failed" || generation.State == "completed") {
				status = "stopped"
			}
			writeJSON(writer, 200, chat.WebToolResult{Status: status, Content: record.Content, Info: generation.WebSearch})
			return
		}
	}
	writeError(writer, 404, "not_found", "The web tool request is unavailable.")
}

func (server *Server) testWebSearchConnection(writer http.ResponseWriter, request *http.Request) {
	if server.searchService == nil {
		writeError(writer, 503, "unavailable", "Web search is unavailable.")
		return
	}
	request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
	var input struct {
		Policy websearch.Policy `json:"policy"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(writer, 400, "validation", "Invalid search policy.")
		return
	}
	input.Policy.MaxResults = 1
	if _, _, err := server.searchService.Search(request.Context(), input.Policy, "Web search connection test"); err != nil {
		writeError(writer, 400, "web_search_connection", err.Error())
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
