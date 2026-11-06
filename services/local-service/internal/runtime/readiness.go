package runtime

import (
	"encoding/json"
	"io"
	"net"
)

func WriteReadiness(output io.Writer, address net.Addr, launchToken string) error {
	return json.NewEncoder(output).Encode(struct {
		URL         string `json:"url"`
		LaunchToken string `json:"launch_token"`
	}{
		URL:         "http://" + address.String(),
		LaunchToken: launchToken,
	})
}
