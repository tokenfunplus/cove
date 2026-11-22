export const conversationKeys = {
  all: ["conversations"] as const,
  lists: ["conversations", "list"] as const,
  list: (archived: boolean) => [...conversationKeys.lists, archived] as const,
  searches: ["conversations", "list", "search"] as const,
  search: (query: string, archived: boolean, filters?: import("@cove/api-contract").ConversationSearchFilter) => filters ? [...conversationKeys.searches, archived, query, filters] as const : [...conversationKeys.searches, archived, query] as const,
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
export const debateKeys = {
  all: ["debates"] as const,
  session: (id: string) => ["debates", id] as const,
  detail: (id: string, before = 0) => ["debates", id, before] as const,
};
export const generationKeys = {
  all: ["generations"] as const,
  context: (id: string) => [...generationKeys.all, "context", id] as const,
  projectContext: (id: string) => [...generationKeys.all, "project-context", id] as const,
  batch: (id: string) => [...generationKeys.all, "batch", id] as const,
};
