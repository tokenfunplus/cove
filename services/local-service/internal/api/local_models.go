package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/chat"
	"github.com/tokenfunplus/cove/services/local-service/internal/documents"
	"github.com/tokenfunplus/cove/services/local-service/internal/localmodels"
	"github.com/tokenfunplus/cove/services/local-service/internal/localsecurity"
	"github.com/tokenfunplus/cove/services/local-service/internal/persistence"
	"github.com/tokenfunplus/cove/services/local-service/internal/retrieval"
)

type projectLocalChat interface {
	ListProjectDocuments(context.Context, string) ([]persistence.LocalDocument, error)
	ReindexProjectDocument(context.Context, string, string) error
	SearchProjectDocuments(context.Context, string, []string, string) (retrieval.Results, error)
	PrepareProjectSources(context.Context, string, string, []retrieval.Selection) ([]chat.PreparedWebSource, error)
	SetProjectSourceUsage(context.Context, string, string, int64, string) (persistence.Project, error)
}

type localChat interface {
	LocalModels() ([]localmodels.Status, error)
	InstallLocalModel(string) error
	CancelLocalModel(context.Context, string) error
	RemoveLocalModel(context.Context, string) error
	ListLocalDocuments(context.Context) ([]persistence.LocalDocument, error)
	ImportLocalDocument(context.Context, documents.Input) error
	ReindexLocalDocument(context.Context, string) error
	DeleteLocalDocument(context.Context, string) error
	SearchLocalDocuments(context.Context, []string, string) (retrieval.Results, error)
	PrepareLocalSources(context.Context, string, []retrieval.Selection) ([]chat.PreparedWebSource, error)
}

func (server *Server) localModelCommand(writer http.ResponseWriter, request *http.Request) {
	service, ok := server.chat.(localChat)
	if !ok {
		writeError(writer, 503, "unavailable", "Local inference is unavailable.")
		return
	}
	var err error
	if request.Method == http.MethodGet {
		var statuses []localmodels.Status
		statuses, err = service.LocalModels()
		if err == nil {
			writeJSON(writer, 200, statuses)
			return
		}
	} else if request.Method == http.MethodDelete {
		err = service.RemoveLocalModel(request.Context(), request.PathValue("model"))
	} else if request.PathValue("action") == "cancel" {
		err = service.CancelLocalModel(request.Context(), request.PathValue("model"))
	} else if request.PathValue("action") == "install" {
		err = service.InstallLocalModel(request.PathValue("model"))
	} else {
		writeError(writer, 404, "not_found", "This local model action is unavailable.")
		return
	}
	if err != nil {
		writeError(writer, 400, "local_model", err.Error())
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) localDocumentCommand(writer http.ResponseWriter, request *http.Request) {
	service, ok := server.chat.(localChat)
	if !ok {
		writeError(writer, 503, "unavailable", "Local documents are unavailable.")
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	var err error
	project := request.URL.Query().Get("project_id")
	projectService, projectSupported := server.chat.(projectLocalChat)
	if project != "" && !projectSupported {
		writeError(writer, 503, "unavailable", "Project document search is unavailable.")
		return
	}
	switch {
	case request.Method == http.MethodGet:
		var items []persistence.LocalDocument
		if project != "" {
			items, err = projectService.ListProjectDocuments(request.Context(), project)
		} else {
			items, err = service.ListLocalDocuments(request.Context())
		}
		if err == nil {
			writeJSON(writer, 200, items)
			return
		}
	case request.Method == http.MethodDelete:
		if project != "" {
			writeError(writer, 400, "validation", "Manage project materials from the project editor.")
			return
		}
		err = service.DeleteLocalDocument(request.Context(), request.PathValue("document"))
	case request.PathValue("action") == "index":
		if project != "" {
			err = projectService.ReindexProjectDocument(request.Context(), project, request.PathValue("document"))
		} else {
			err = service.ReindexLocalDocument(request.Context(), request.PathValue("document"))
		}
	case request.URL.Path == "/api/local-documents":
		if project != "" {
			writeError(writer, 400, "validation", "Add project materials from the project editor.")
			return
		}
		request.Body = http.MaxBytesReader(writer, request.Body, 6<<20)
		var input documents.Input
		if decodeJSON(request, &input) != nil {
			writeError(writer, 400, "invalid_attachment", "Choose a document of up to 4 MiB.")
			return
		}
		err = service.ImportLocalDocument(request.Context(), input)
	case request.URL.Path == "/api/local-documents/search":
		request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
		var input struct {
			Documents []string `json:"document_ids"`
			Query     string   `json:"query"`
		}
		if decodeJSON(request, &input) != nil {
			writeError(writer, 400, "validation", "The document search request is invalid.")
			return
		}
		var result retrieval.Results
		if project != "" {
			result, err = projectService.SearchProjectDocuments(request.Context(), project, input.Documents, input.Query)
		} else {
			result, err = service.SearchLocalDocuments(request.Context(), input.Documents, input.Query)
		}
		if err == nil {
			writeJSON(writer, 200, result)
			return
		}
	case request.URL.Path == "/api/local-documents/prepare":
		request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
		var input struct {
			Selections []retrieval.Selection `json:"selections"`
		}
		if decodeJSON(request, &input) != nil {
			writeError(writer, 400, "validation", "The source selection is invalid.")
			return
		}
		session, _ := localsecurity.SessionFromRequest(request)
		var sources []chat.PreparedWebSource
		if project != "" {
			sources, err = projectService.PrepareProjectSources(request.Context(), project, session.ID, input.Selections)
		} else {
			sources, err = service.PrepareLocalSources(request.Context(), session.ID, input.Selections)
		}
		if err == nil {
			writeJSON(writer, 200, sources)
			return
		}
	default:
		writeError(writer, 404, "not_found", "This local document action is unavailable.")
		return
	}
	if err != nil {
		status := 400
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		writeError(writer, status, "local_document", err.Error())
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) projectSourceUsage(writer http.ResponseWriter, request *http.Request) {
	service, ok := server.chat.(projectLocalChat)
	if !ok {
		writeError(writer, 503, "unavailable", "Project materials are unavailable.")
		return
	}
	var input struct {
		Revision int64  `json:"revision"`
		Usage    string `json:"usage"`
	}
	if decodeJSON(request, &input) != nil {
		writeProjectError(writer, persistence.ErrInvalidProject)
		return
	}
	result, err := service.SetProjectSourceUsage(request.Context(), request.PathValue("project"), request.PathValue("source"), input.Revision, input.Usage)
	if err != nil {
		writeProjectError(writer, err)
		return
	}
	writeJSON(writer, 200, result)
}
