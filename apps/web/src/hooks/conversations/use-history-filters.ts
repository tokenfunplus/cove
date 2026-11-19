import { useEffect, useMemo, useState } from "react";
import { defaultHistoryFilters, historyFiltersStorageKey, historyQueryFilter, parseHistoryFilters, type HistoryFilters } from "@/components/conversations/history-filters";

export function useHistoryFilters() {
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(() => {
    try { return parseHistoryFilters(window.localStorage.getItem(historyFiltersStorageKey)); }
    catch { return defaultHistoryFilters; }
  });
  const [day, setDay] = useState(0);
  useEffect(() => {
    try { window.localStorage.setItem(historyFiltersStorageKey, JSON.stringify(historyFilters)); }
    catch { /* Filters still work when browser storage is unavailable. */ }
  }, [historyFilters]);
  useEffect(() => {
    if (historyFilters.activity === "all") return;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(() => setDay(day => day + 1), midnight.getTime() - now.getTime() + 50);
    return () => window.clearTimeout(timer);
  }, [historyFilters.activity, day]);
  const historyQueryFilters = useMemo(() => historyQueryFilter(historyFilters), [historyFilters, day]);
  return { historyFilters, setHistoryFilters, historyQueryFilters };
}
