package localmodels

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// FetchArtifact checks range boundaries against the pinned byte count. A host
// that ignores Range safely restarts the file; a malformed partial response fails.
func FetchArtifact(ctx context.Context, client *http.Client, source string, size, offset int64) (io.ReadCloser, bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, false, err
	}
	request.Header.Set("Accept-Encoding", "identity")
	if offset > 0 {
		request.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, false, errors.New("The model source could not be reached. Check your connection and retry to resume.")
	}
	if response.StatusCode == http.StatusPartialContent && offset > 0 && response.Header.Get("Content-Range") == fmt.Sprintf("bytes %d-%d/%d", offset, size-1, size) {
		return response.Body, true, nil
	}
	if response.StatusCode == http.StatusOK {
		return response.Body, false, nil
	}
	response.Body.Close()
	return nil, false, fmt.Errorf("The model source could not serve this download or resume range (HTTP %d).", response.StatusCode)
}
