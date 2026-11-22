import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

export function createLocalServiceQueryClient(config: QueryClientConfig = {}) {
  // Every query and command targets the loopback Local Service. Browser internet
  // reachability does not determine whether that service can accept a request.
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: {
        ...config.defaultOptions?.queries,
        networkMode: "always",
      },
      mutations: {
        ...config.defaultOptions?.mutations,
        networkMode: "always",
      },
    },
  });
}
