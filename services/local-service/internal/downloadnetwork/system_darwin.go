//go:build darwin && cgo

package downloadnetwork

/*
#cgo LDFLAGS: -framework CFNetwork -framework CoreFoundation
#include <stdlib.h>
#include "system_darwin.h"
*/
import "C"

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strconv"
	"time"
	"unsafe"
)

const systemProxySupported = true

func nativeProxies(result C.CoveDownloadProxies) ([]*url.URL, bool, error) {
	defer C.cove_download_free_proxies(result)
	if result.failed != 0 || result.count == 0 {
		return nil, true, errors.New("System proxy resolution failed.")
	}
	routes := make([]*url.URL, int(result.count))
	for index := range routes {
		route := result.routes[index]
		if route.kind == 0 {
			continue
		}
		scheme := "http"
		if route.kind == 3 {
			scheme = "socks5"
		}
		routes[index] = &url.URL{Scheme: scheme, Host: net.JoinHostPort(C.GoString(route.host), strconv.Itoa(int(route.port)))}
	}
	return routes, result.configured != 0, nil
}

func systemProxy(ctx context.Context, target *url.URL) ([]*url.URL, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, true, err
	}
	timeout := 3 * time.Second
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < timeout {
		timeout = time.Until(deadline)
	}
	text := C.CString(target.String())
	defer C.free(unsafe.Pointer(text))
	proxy, configured, err := nativeProxies(C.cove_download_system_proxy(text, C.double(timeout.Seconds())))
	if ctx.Err() != nil {
		return nil, true, ctx.Err()
	}
	return proxy, configured, err
}

func proxyForPAC(script string, target *url.URL) ([]*url.URL, bool, error) {
	source, text := C.CString(script), C.CString(target.String())
	defer C.free(unsafe.Pointer(source))
	defer C.free(unsafe.Pointer(text))
	return nativeProxies(C.cove_download_pac_proxy(source, text))
}
