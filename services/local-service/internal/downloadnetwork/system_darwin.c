//go:build darwin && cgo

#include <CFNetwork/CFNetwork.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>
#include <string.h>
#include "system_darwin.h"

static int enabled(CFDictionaryRef settings, CFStringRef key) {
    CFTypeRef value = CFDictionaryGetValue(settings, key);
    if (!value) return 0;
    if (CFGetTypeID(value) == CFBooleanGetTypeID()) return CFBooleanGetValue(value);
    int number = 0;
    if (CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue(value, kCFNumberIntType, &number);
    return number != 0;
}

static int configured(CFDictionaryRef settings, int depth) {
    if (!settings || depth > 3) return 0;
    if (enabled(settings, kCFNetworkProxiesHTTPEnable) || enabled(settings, kCFNetworkProxiesHTTPSEnable) ||
        enabled(settings, kCFNetworkProxiesSOCKSEnable) || enabled(settings, kCFNetworkProxiesProxyAutoConfigEnable) ||
        enabled(settings, kCFNetworkProxiesProxyAutoDiscoveryEnable)) return 1;
    CFDictionaryRef scoped = CFDictionaryGetValue(settings, CFSTR("__SCOPED__"));
    if (!scoped || CFGetTypeID(scoped) != CFDictionaryGetTypeID()) return 0;
    CFIndex count = CFDictionaryGetCount(scoped);
    const void **values = calloc((size_t)count, sizeof(void *));
    if (!values) return 0;
    CFDictionaryGetKeysAndValues(scoped, NULL, values);
    int found = 0;
    for (CFIndex i = 0; i < count && !found; i++) {
        if (CFGetTypeID(values[i]) == CFDictionaryGetTypeID()) found = configured(values[i], depth + 1);
    }
    free(values);
    return found;
}

typedef struct { int done; CFArrayRef result; } CovePACResult;

static void pac_complete(void *info, CFArrayRef proxies, CFErrorRef error) {
    CovePACResult *state = info;
    if (!error && proxies) state->result = CFRetain(proxies);
    state->done = 1;
}

static CFArrayRef resolve_pac(CFURLRef source, CFStringRef script, CFURLRef target, double timeout) {
    CovePACResult state = {0};
    CFStreamClientContext context = {0, &state, NULL, NULL, NULL};
    CFRunLoopSourceRef task = source
        ? CFNetworkExecuteProxyAutoConfigurationURL(source, target, pac_complete, &context)
        : CFNetworkExecuteProxyAutoConfigurationScript(script, target, pac_complete, &context);
    if (!task) return NULL;
    CFRunLoopRef loop = CFRunLoopGetCurrent();
    CFRunLoopAddSource(loop, task, kCFRunLoopDefaultMode);
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + timeout;
    while (!state.done && CFAbsoluteTimeGetCurrent() < deadline) {
        double remaining = deadline - CFAbsoluteTimeGetCurrent();
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, remaining < 0.1 ? remaining : 0.1, true);
    }
    CFRunLoopRemoveSource(loop, task, kCFRunLoopDefaultMode);
    CFRunLoopSourceInvalidate(task);
    CFRelease(task);
    return state.result;
}

static CoveDownloadProxy select_proxy(CFArrayRef proxies, CFURLRef target, double timeout, int depth) {
    CoveDownloadProxy result = {.configured = 1, .failed = 1};
    if (!proxies || depth > 2) return result;
    for (CFIndex i = 0; i < CFArrayGetCount(proxies); i++) {
        CFDictionaryRef entry = CFArrayGetValueAtIndex(proxies, i);
        if (!entry || CFGetTypeID(entry) != CFDictionaryGetTypeID()) continue;
        CFStringRef type = CFDictionaryGetValue(entry, kCFProxyTypeKey);
        if (!type || CFGetTypeID(type) != CFStringGetTypeID()) continue;
        if (CFEqual(type, kCFProxyTypeNone)) { result.failed = 0; return result; }
        if (CFEqual(type, kCFProxyTypeAutoConfigurationURL)) {
            CFURLRef source = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationURLKey);
            CFArrayRef resolved = source ? resolve_pac(source, NULL, target, timeout) : NULL;
            result = select_proxy(resolved, target, timeout, depth + 1);
            if (resolved) CFRelease(resolved);
            return result;
        }
        if (CFEqual(type, kCFProxyTypeAutoConfigurationJavaScript)) {
            CFStringRef script = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationJavaScriptKey);
            CFArrayRef resolved = script ? resolve_pac(NULL, script, target, timeout) : NULL;
            result = select_proxy(resolved, target, timeout, depth + 1);
            if (resolved) CFRelease(resolved);
            return result;
        }
        // macOS Secure Web Proxy is an HTTP CONNECT proxy for HTTPS requests.
        int kind = (CFEqual(type, kCFProxyTypeHTTP) || CFEqual(type, kCFProxyTypeHTTPS)) ? 1 : CFEqual(type, kCFProxyTypeSOCKS) ? 3 : 0;
        if (!kind) continue;
        CFStringRef user = CFDictionaryGetValue(entry, kCFProxyUsernameKey);
        CFStringRef password = CFDictionaryGetValue(entry, kCFProxyPasswordKey);
        if ((user && CFStringGetLength(user)) || (password && CFStringGetLength(password))) return result;
        CFStringRef host = CFDictionaryGetValue(entry, kCFProxyHostNameKey);
        CFNumberRef port = CFDictionaryGetValue(entry, kCFProxyPortNumberKey);
        if (!host || !port || CFGetTypeID(host) != CFStringGetTypeID() || CFGetTypeID(port) != CFNumberGetTypeID()) return result;
        CFNumberGetValue(port, kCFNumberIntType, &result.port);
        CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(host), kCFStringEncodingUTF8) + 1;
        if (size > 4096 || result.port < 1 || result.port > 65535) return result;
        result.host = calloc((size_t)size, 1);
        if (!result.host || !CFStringGetCString(host, result.host, size, kCFStringEncodingUTF8)) {
            free(result.host); result.host = NULL; return result;
        }
        result.kind = kind;
        result.failed = 0;
        return result;
    }
    return result;
}

CoveDownloadProxy cove_download_system_proxy(const char *url, double timeout) {
    CoveDownloadProxy result = {0};
    CFStringRef text = CFStringCreateWithCString(NULL, url, kCFStringEncodingUTF8);
    CFURLRef target = text ? CFURLCreateWithString(NULL, text, NULL) : NULL;
    CFDictionaryRef settings = CFNetworkCopySystemProxySettings();
    if (!target || !settings) { result.failed = 1; goto done; }
    CFArrayRef proxies = CFNetworkCopyProxiesForURL(target, settings);
    result = select_proxy(proxies, target, timeout, 0);
    if (!result.kind && !configured(settings, 0)) result.configured = 0;
    if (proxies) CFRelease(proxies);
done:
    if (settings) CFRelease(settings);
    if (target) CFRelease(target);
    if (text) CFRelease(text);
    return result;
}

CoveDownloadProxy cove_download_pac_proxy(const char *source, const char *url) {
    CFStringRef script = CFStringCreateWithCString(NULL, source, kCFStringEncodingUTF8);
    CFStringRef text = CFStringCreateWithCString(NULL, url, kCFStringEncodingUTF8);
    CFURLRef target = text ? CFURLCreateWithString(NULL, text, NULL) : NULL;
    CFArrayRef proxies = script && target ? resolve_pac(NULL, script, target, 3) : NULL;
    CoveDownloadProxy result = select_proxy(proxies, target, 3, 0);
    if (proxies) CFRelease(proxies);
    if (script) CFRelease(script);
    if (target) CFRelease(target);
    if (text) CFRelease(text);
    return result;
}
