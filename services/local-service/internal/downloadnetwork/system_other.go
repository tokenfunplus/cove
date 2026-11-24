//go:build !darwin || !cgo

package downloadnetwork

import (
	"context"
	"net/url"
)

const systemProxySupported = false

func systemProxy(context.Context, *url.URL) (*url.URL, bool, error) { return nil, false, nil }
