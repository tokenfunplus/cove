import type { Conversation, ConversationSearchFilter } from "@cove/api-contract";

export type HistoryFilters = {
  activity: "all" | "today" | "7d" | "30d";
  kind: "all" | "chat" | "debate";
};
export const defaultHistoryFilters: HistoryFilters = { activity: "all", kind: "all" };
export const historyFiltersStorageKey = "cove:history-filters:v1";

export function parseHistoryFilters(raw: string | null): HistoryFilters {
  try {
    if (raw && raw.length > 512) return defaultHistoryFilters;
    const data: unknown = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object") return defaultHistoryFilters;
    const value = data as Record<string, unknown>;
    return {
      activity: typeof value.activity === "string" && ["all", "today", "7d", "30d"].includes(value.activity) ? value.activity as HistoryFilters["activity"] : "all",
      kind: typeof value.kind === "string" && ["all", "chat", "debate"].includes(value.kind) ? value.kind as HistoryFilters["kind"] : "all",
    };
  } catch { return defaultHistoryFilters; }
}

/** Calendar-day boundaries use the browser's local timezone, including DST. */
export function historyQueryFilter(filters: HistoryFilters, now = new Date()): ConversationSearchFilter {
  const result: ConversationSearchFilter = {};
  if (filters.kind !== "all") result.kind = filters.kind;
  if (filters.activity !== "all") {
    const days = filters.activity === "today" ? 1 : filters.activity === "7d" ? 7 : 30;
    result.updatedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1).toISOString();
  }
  return result;
}

export function filterHistory<T extends Conversation>(conversations: T[], filter: ConversationSearchFilter): T[] {
  const cutoff = filter.updatedAfter ? Date.parse(filter.updatedAfter) : undefined;
  return conversations.filter(conversation =>
    (filter.kind === undefined || (filter.kind === "debate") === Boolean(conversation.debate_id)) &&
    (cutoff === undefined || Date.parse(conversation.updated_at) >= cutoff),
  );
}
