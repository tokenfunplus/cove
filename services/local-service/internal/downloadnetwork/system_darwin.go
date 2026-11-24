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

func nativeProxy(result C.CoveDownloadProxy) (*url.URL, bool, error) {
	if result.host != nil {
		defer C.free(unsafe.Pointer(result.host))
	}
	if result.failed != 0 {
		return nil, true, errors.New("System proxy resolution failed.")
	}
	if result.kind == 0 {
		return nil, result.configured != 0, nil
	}
	scheme := "http"
	if result.kind == 3 {
		scheme = "socks5"
	}
	return &url.URL{Scheme: scheme, Host: net.JoinHostPort(C.GoString(result.host), strconv.Itoa(int(result.port)))}, true, nil
}

func systemProxy(ctx context.Context, target *url.URL) (*url.URL, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, true, err
	}
	timeout := 3 * time.Second
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < timeout {
		timeout = time.Until(deadline)
	}
	text := C.CString(target.String())
	defer C.free(unsafe.Pointer(text))
	proxy, configured, err := nativeProxy(C.cove_download_system_proxy(text, C.double(timeout.Seconds())))
	if ctx.Err() != nil {
		return nil, true, ctx.Err()
	}
	return proxy, configured, err
}

func proxyForPAC(script string, target *url.URL) (*url.URL, bool, error) {
	source, text := C.CString(script), C.CString(target.String())
	defer C.free(unsafe.Pointer(source))
	defer C.free(unsafe.Pointer(text))
	return nativeProxy(C.cove_download_pac_proxy(source, text))
}
