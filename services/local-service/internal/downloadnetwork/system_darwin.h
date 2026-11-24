#ifndef COVE_DOWNLOAD_NETWORK_PROXY_H
#define COVE_DOWNLOAD_NETWORK_PROXY_H

#define COVE_MAX_PROXY_ROUTES 32

typedef struct {
    char *host;
    int port;
    int kind;
} CoveDownloadProxy;

typedef struct {
    CoveDownloadProxy routes[COVE_MAX_PROXY_ROUTES];
    int count;
    int configured;
    int failed;
} CoveDownloadProxies;

CoveDownloadProxies cove_download_system_proxy(const char *url, double timeout);
CoveDownloadProxies cove_download_pac_proxy(const char *script, const char *url);
void cove_download_free_proxies(CoveDownloadProxies proxies);

#endif
