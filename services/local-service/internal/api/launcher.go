package api

import "net/http"

func (server *Server) launcherStatus(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Cache-Control", "no-store")
	if server.providerSetup == nil {
		writeError(writer, http.StatusServiceUnavailable, "provider_setup_unavailable", "Provider setup status is unavailable.")
		return
	}
	profiles, err := server.providerSetup.List(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "Provider setup status is unavailable.")
		return
	}
	needsSetup := true
	for _, profile := range profiles {
		if profile.Configured {
			needsSetup = false
			break
		}
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"provider_setup_required": needsSetup})
}
