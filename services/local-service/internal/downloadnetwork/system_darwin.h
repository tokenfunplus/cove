typedef struct {
    char *host;
    int port;
    int kind;
    int configured;
    int failed;
} CoveDownloadProxy;

CoveDownloadProxy cove_download_system_proxy(const char *url, double timeout);
CoveDownloadProxy cove_download_pac_proxy(const char *script, const char *url);
