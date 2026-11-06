package api

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/tokenfunplus/cove/services/local-service/internal/webassets"
)

func (server *Server) shell(writer http.ResponseWriter, request *http.Request) {
	server.writeStaticHeaders(writer)

	server.serveEmbeddedFile(writer, request, "index.html")
}

func (server *Server) assets(writer http.ResponseWriter, request *http.Request) {
	server.writeStaticHeaders(writer)

	path := strings.TrimPrefix(request.URL.Path, "/assets/")
	if path == "" || strings.Contains(path, "..") {
		http.NotFound(writer, request)
		return
	}
	server.serveEmbeddedFile(writer, request, "assets/"+path)
}

func (server *Server) serveEmbeddedFile(writer http.ResponseWriter, request *http.Request, path string) {
	contents, err := fs.ReadFile(webassets.Files(), path)
	if err != nil {
		http.NotFound(writer, request)
		return
	}
	if strings.HasSuffix(path, ".html") {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	} else if strings.HasSuffix(path, ".js") {
		writer.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	} else if strings.HasSuffix(path, ".css") {
		writer.Header().Set("Content-Type", "text/css; charset=utf-8")
	} else if strings.HasSuffix(path, ".txt") {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	_, _ = writer.Write(contents)
}

func (server *Server) writeStaticHeaders(writer http.ResponseWriter) {
	// Browser-side attestation validation may retrieve Intel TDX collateral and
	// verify NVIDIA GPU evidence. These are fixed SDK verifier origins; all
	// NearAI protocol traffic still uses the session-authorized local proxy.
	writer.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; connect-src 'self' https://pccs.phala.network https://nras.attestation.nvidia.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'")
	writer.Header().Set("Referrer-Policy", "no-referrer")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("X-Frame-Options", "DENY")
}
