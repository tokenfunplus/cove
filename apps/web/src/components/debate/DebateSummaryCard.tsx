import type { DebateStageSummary } from "@cove/api-contract";
import { Button } from "@/components/ui/button";

export function DebateSummaryCard({ summary, onInspect }: { summary: DebateStageSummary; onInspect: (id: string) => void }) {
  return <section className="space-y-4 rounded-xl border border-primary/20 bg-accent/20 p-4" aria-label={`Stage summary, rounds ${summary.from_round} to ${summary.through_round}`}>
    <div><h3 className="text-sm font-semibold">Stage summary · Rounds {summary.from_round}–{summary.through_round}</h3><p className="mt-1 text-xs text-muted-foreground">AI-generated from public statements. Check the linked turns when assessing these interpretations.</p></div>
    {([['New ideas', summary.new_ideas], ['Position changes', summary.position_changes], ['Open questions', summary.open_questions]] as const).map(([title, points]) => <div className="space-y-2" key={title}>
      <h4 className="text-xs font-semibold text-primary">{title}</h4>
      {points.length ? <ul className="space-y-3">{points.map((point, index) => <li key={index} className="space-y-1 text-sm leading-relaxed"><p className="whitespace-pre-wrap break-words">{point.text}</p><div className="flex flex-wrap gap-1">{point.sources.map(source => <Button key={source.turn_id} size="xs" variant="outline" onClick={() => onInspect(source.turn_id)} title={`Inspect seat ${source.seat + 1}, turn ${source.sequence}`}>Turn {source.sequence}</Button>)}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">No supported {title.toLowerCase()} were identified in this stage.</p>}
    </div>)}
  </section>;
}
