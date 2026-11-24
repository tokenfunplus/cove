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

static int append_proxies(CoveDownloadProxies *result, CFArrayRef proxies, CFURLRef target, CFAbsoluteTime deadline, int depth) {
    if (!proxies || CFGetTypeID(proxies) != CFArrayGetTypeID() || depth > 2) return 0;
    int start = result->count;
    for (CFIndex i = 0; i < CFArrayGetCount(proxies); i++) {
        CFDictionaryRef entry = CFArrayGetValueAtIndex(proxies, i);
        if (!entry || CFGetTypeID(entry) != CFDictionaryGetTypeID()) continue;
        CFStringRef type = CFDictionaryGetValue(entry, kCFProxyTypeKey);
        if (!type || CFGetTypeID(type) != CFStringGetTypeID()) continue;
        if (CFEqual(type, kCFProxyTypeAutoConfigurationURL) || CFEqual(type, kCFProxyTypeAutoConfigurationJavaScript)) {
            double remaining = deadline - CFAbsoluteTimeGetCurrent();
            if (remaining <= 0) return 0;
            CFArrayRef resolved = NULL;
            if (CFEqual(type, kCFProxyTypeAutoConfigurationURL)) {
                CFURLRef source = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationURLKey);
                if (source && CFGetTypeID(source) == CFURLGetTypeID()) resolved = resolve_pac(source, NULL, target, remaining);
            } else {
                CFStringRef script = CFDictionaryGetValue(entry, kCFProxyAutoConfigurationJavaScriptKey);
                if (script && CFGetTypeID(script) == CFStringGetTypeID()) resolved = resolve_pac(NULL, script, target, remaining);
            }
            int valid = append_proxies(result, resolved, target, deadline, depth + 1);
            if (resolved) CFRelease(resolved);
            if (!valid) return 0;
            continue;
        }
        if (CFEqual(type, kCFProxyTypeNone)) {
            if (result->count == COVE_MAX_PROXY_ROUTES) return 0;
            result->routes[result->count++] = (CoveDownloadProxy){0};
            continue;
        }
        // macOS Secure Web Proxy is an HTTP CONNECT proxy for HTTPS requests.
        int kind = (CFEqual(type, kCFProxyTypeHTTP) || CFEqual(type, kCFProxyTypeHTTPS)) ? 1 : CFEqual(type, kCFProxyTypeSOCKS) ? 3 : 0;
        if (!kind) continue;
        CFTypeRef user = CFDictionaryGetValue(entry, kCFProxyUsernameKey);
        CFTypeRef password = CFDictionaryGetValue(entry, kCFProxyPasswordKey);
        if ((user && (CFGetTypeID(user) != CFStringGetTypeID() || CFStringGetLength(user))) ||
            (password && (CFGetTypeID(password) != CFStringGetTypeID() || CFStringGetLength(password)))) return 0;
        CFStringRef host = CFDictionaryGetValue(entry, kCFProxyHostNameKey);
        CFNumberRef port = CFDictionaryGetValue(entry, kCFProxyPortNumberKey);
        if (!host || !port || CFGetTypeID(host) != CFStringGetTypeID() || CFGetTypeID(port) != CFNumberGetTypeID()) return 0;
        int number = 0;
        if (!CFNumberGetValue(port, kCFNumberIntType, &number)) return 0;
        CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(host), kCFStringEncodingUTF8) + 1;
        if (size < 2 || size > 4096 || number < 1 || number > 65535 || result->count == COVE_MAX_PROXY_ROUTES) return 0;
        char *name = calloc((size_t)size, 1);
        if (!name || !CFStringGetCString(host, name, size, kCFStringEncodingUTF8) || !name[0] || strpbrk(name, " \t\r\n/\\")) {
            free(name); return 0;
        }
        result->routes[result->count++] = (CoveDownloadProxy){.host = name, .port = number, .kind = kind};
    }
    return result->count > start;
}

void cove_download_free_proxies(CoveDownloadProxies proxies) {
    for (int i = 0; i < proxies.count; i++) free(proxies.routes[i].host);
}

CoveDownloadProxies cove_download_system_proxy(const char *url, double timeout) {
    CoveDownloadProxies result = {.configured = 1, .failed = 1};
    CFStringRef text = CFStringCreateWithCString(NULL, url, kCFStringEncodingUTF8);
    CFURLRef target = text ? CFURLCreateWithString(NULL, text, NULL) : NULL;
    CFDictionaryRef settings = CFNetworkCopySystemProxySettings();
    if (!target || !settings) goto done;
    CFArrayRef proxies = CFNetworkCopyProxiesForURL(target, settings);
    result.failed = !append_proxies(&result, proxies, target, CFAbsoluteTimeGetCurrent() + timeout, 0);
    if (!result.failed && result.count == 1 && result.routes[0].kind == 0 && !configured(settings, 0)) result.configured = 0;
    if (proxies) CFRelease(proxies);
done:
    if (settings) CFRelease(settings);
    if (target) CFRelease(target);
    if (text) CFRelease(text);
    return result;
}

CoveDownloadProxies cove_download_pac_proxy(const char *source, const char *url) {
    CoveDownloadProxies result = {.configured = 1, .failed = 1};
    CFStringRef script = CFStringCreateWithCString(NULL, source, kCFStringEncodingUTF8);
    CFStringRef text = CFStringCreateWithCString(NULL, url, kCFStringEncodingUTF8);
    CFURLRef target = text ? CFURLCreateWithString(NULL, text, NULL) : NULL;
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 3;
    CFArrayRef proxies = script && target ? resolve_pac(NULL, script, target, 3) : NULL;
    result.failed = !append_proxies(&result, proxies, target, deadline, 0);
    if (proxies) CFRelease(proxies);
    if (script) CFRelease(script);
    if (target) CFRelease(target);
    if (text) CFRelease(text);
    return result;
}
