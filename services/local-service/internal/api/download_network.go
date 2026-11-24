package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/tokenfunplus/cove/services/local-service/internal/downloadnetwork"
)

func (server *Server) networkSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if server.downloadNetwork == nil {
		writeError(w, 503, "unavailable", "Download network settings are unavailable.")
		return
	}
	view, err := server.downloadNetwork.Settings()
	if err != nil {
		writeError(w, 500, "network_configuration", err.Error())
		return
	}
	writeJSON(w, 200, view)
}

func (server *Server) networkInput(w http.ResponseWriter, r *http.Request) (downloadnetwork.Settings, bool) {
	w.Header().Set("Cache-Control", "no-store")
	if server.downloadNetwork == nil {
		writeError(w, 503, "unavailable", "Download network settings are unavailable.")
		return downloadnetwork.Settings{}, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var value downloadnetwork.Settings
	if err := decoder.Decode(&value); err != nil {
		writeError(w, 400, "validation", "The download network configuration is invalid.")
		return value, false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "validation", "The download network configuration is invalid.")
		return value, false
	}
	value, err := downloadnetwork.Normalize(value)
	if err != nil {
		writeError(w, 400, "validation", err.Error())
		return value, false
	}
	return value, true
}

func (server *Server) saveNetworkSettings(w http.ResponseWriter, r *http.Request) {
	value, ok := server.networkInput(w, r)
	if !ok {
		return
	}
	view, err := server.downloadNetwork.Save(r.Context(), value)
	if err != nil {
		writeError(w, 500, "network_configuration", err.Error())
		return
	}
	writeJSON(w, 200, view)
}

func (server *Server) testNetwork(w http.ResponseWriter, r *http.Request) {
	value, ok := server.networkInput(w, r)
	if !ok {
		return
	}
	result, err := server.downloadNetwork.Test(r.Context(), value)
	if err != nil {
		writeError(w, 400, "network_test", err.Error())
		return
	}
	writeJSON(w, 200, result)
}
