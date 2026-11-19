import { useId } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { historyCopy as copy } from "@/messages/history";
import { historyStyles as styles } from "@/styles/history";
import { defaultHistoryFilters, type HistoryFilters } from "./history-filters";

export function HistoryToolbar({ filters, onChange, count, pending, archived }: {
  filters: HistoryFilters;
  onChange: (filters: HistoryFilters) => void;
  count: number;
  pending: boolean;
  archived: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const activity = { all: copy.allTime, today: copy.today, "7d": copy.last7Days, "30d": copy.last30Days };
  const kinds = { all: copy.allTypes, chat: copy.chat, debate: copy.debate };
  const active = Number(filters.activity !== "all") + Number(filters.kind !== "all");
  return <>
    <div className={styles.toolbar}>
      <div className={styles.heading}>
        <h2 className="text-xs font-medium tracking-normal">{archived ? copy.archived : copy.title}</h2>
        <span className={styles.count} aria-label={pending ? "Loading history results" : `${count} conversations`}>{pending ? "…" : count}</span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" className={styles.trigger} aria-label={copy.filterAction} title={copy.filterAction} data-filter-active={active ? "true" : undefined}>
            <SlidersHorizontal aria-hidden="true" />
            {active > 0 && <span className={styles.indicator} aria-hidden="true">{active}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className={styles.content} aria-labelledby={titleId} aria-describedby={descriptionId}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" id={titleId}>{copy.filters}</h3>
            {active > 0 && <Button type="button" size="xs" variant="ghost" onClick={() => onChange(defaultHistoryFilters)}>{copy.reset}</Button>}
          </div>
          <div className={styles.field}>
            <span>{copy.activity}</span>
            <Select value={filters.activity} onValueChange={value => onChange({ ...filters, activity: value as HistoryFilters["activity"] })}>
              <SelectTrigger className={styles.select} aria-label={copy.activity}><SelectValue /></SelectTrigger>
              <SelectContent className={styles.selectContent}>{Object.entries(activity).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={styles.field}>
            <span>{copy.kind}</span>
            <Select value={filters.kind} onValueChange={value => onChange({ ...filters, kind: value as HistoryFilters["kind"] })}>
              <SelectTrigger className={styles.select} aria-label={copy.kind}><SelectValue /></SelectTrigger>
              <SelectContent className={styles.selectContent}>{Object.entries(kinds).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">{copy.description}</p>
        </PopoverContent>
      </Popover>
    </div>
    {active > 0 && <div className={styles.chips} aria-label="Active history filters">
      {filters.activity !== "all" && <Button type="button" size="xs" variant="outline" className={styles.chip} aria-label={copy.clearActivity} onClick={() => onChange({ ...filters, activity: "all" })}>{activity[filters.activity]}<X aria-hidden="true" /></Button>}
      {filters.kind !== "all" && <Button type="button" size="xs" variant="outline" className={styles.chip} aria-label={copy.clearKind} onClick={() => onChange({ ...filters, kind: "all" })}>{kinds[filters.kind]}<X aria-hidden="true" /></Button>}
    </div>}
  </>;
}
