export const conversationKeys = {
  all: ["conversations"] as const,
  lists: ["conversations", "list"] as const,
  list: (archived: boolean) => [...conversationKeys.lists, archived] as const,
  searches: ["conversations", "list", "search"] as const,
  search: (query: string, archived: boolean) => [...conversationKeys.searches, archived, query] as const,
  detail: (id: string | undefined) =>
    [...conversationKeys.all, "detail", id] as const,
};

export const providerKeys = {
  all: ["providers"] as const,
  list: ["providers", "list"] as const,
  catalog: (id: string) => [...providerKeys.all, "catalog", id] as const,
};

export const settingsKey = ["settings"] as const;
export const sessionKey = ["local-session"] as const;
export const generationKeys = {
  all: ["generations"] as const,
  context: (id: string) => [...generationKeys.all, "context", id] as const,
  batch: (id: string) => [...generationKeys.all, "batch", id] as const,
};
