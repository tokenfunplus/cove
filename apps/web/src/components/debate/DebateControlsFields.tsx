import { Disclosure, DisclosureTrigger, DisclosureContent } from "@/components/ui/disclosure";
import { Checkbox } from "@/components/ui/checkbox";
import type { DebateControls, DebateSeat, DebateUsage } from "@cove/api-contract";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function debateControls(seats: number, initial?: DebateControls): DebateControls {
  return {
    version: initial?.version ?? 0,
    summary_every: initial?.summary_every ?? 0,
    summary_seat: Math.min(initial?.summary_seat ?? 0, Math.max(0, seats - 1)),
    turn_delay_ms: initial?.turn_delay_ms ?? 1000,
    token_budget: initial?.token_budget,
    cost_budget_usd: initial?.cost_budget_usd,
    auto_pause: initial?.auto_pause ?? false,
    rates: Array.from({ length: seats }, (_, index) => ({ ...initial?.rates?.[index] })),
  };
}

export function debateControlsError(controls: DebateControls, seats: number): string {
  if (controls.token_budget !== undefined && (!Number.isSafeInteger(controls.token_budget) || controls.token_budget < 1 || controls.token_budget > 1e12)) return "Choose a positive whole-token budget, up to 1 trillion tokens.";
  if (controls.cost_budget_usd !== undefined && (!Number.isFinite(controls.cost_budget_usd) || controls.cost_budget_usd <= 0 || controls.cost_budget_usd > 1e6)) return "Choose a positive cost budget, up to $1,000,000.";
  if (controls.rates?.some(rate => [rate.input_per_million, rate.output_per_million].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1e6)))) return "Rates must be between $0 and $1,000,000 per million tokens.";
  if (controls.cost_budget_usd !== undefined && (controls.rates?.length !== seats || controls.rates.some(rate => rate.input_per_million === undefined || rate.output_per_million === undefined))) return "Add input and output rates for every seat to use a cost budget.";
  return "";
}

function Choice({ label, value, options, onChange }: { label: string; value: number; options: { value: number; label: string }[]; onChange: (value: number) => void }) {
  return <label className="grid min-w-0 gap-2 text-sm"><span>{label}</span><Select value={String(value)} onValueChange={value => onChange(Number(value))}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem value={String(option.value)} key={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>;
}

export function DebateControlsFields({ controls, seats, onChange }: { controls: DebateControls; seats: DebateSeat[]; onChange: (controls: DebateControls) => void }) {
  const update = (patch: Partial<DebateControls>) => onChange({ ...controls, ...patch });
  const error = debateControlsError(controls, seats.length);
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <Choice label="Stage summaries" value={controls.summary_every} onChange={summary_every => update({ summary_every })} options={[{ value: 0, label: "Off" }, ...Array.from({ length: 10 }, (_, index) => index + 1).map(value => ({ value, label: `Every ${value} round${value === 1 ? "" : "s"}` }))]} />
      <Choice label="Turn interval" value={controls.turn_delay_ms ?? 1000} onChange={turn_delay_ms => update({ turn_delay_ms })} options={[...new Set([0, 1000, 3000, 5000, 10000, 30000, 60000, controls.turn_delay_ms ?? 1000])].sort((a,b) => a-b).map(value => ({ value, label: value ? `${value / 1000} second${value === 1000 ? "" : "s"}` : "No delay" }))} />
    </div>
    {controls.summary_every > 0 && <div className="space-y-2">
      {seats.length > 0 && <Choice label="Summary model" value={controls.summary_seat} onChange={summary_seat => update({ summary_seat })} options={seats.map((seat, index) => ({ value: index, label: `Seat ${index + 1} · ${seat.model_id}` }))} />}
      <p className="text-xs leading-relaxed text-muted-foreground">Summaries highlight new ideas, supported position changes, and open questions with linked turns. Each summary makes an extra call to this model, with up to 2,048 output tokens, and counts toward usage.</p>
    </div>}
    <p className="text-xs text-muted-foreground">The interval applies between calls after independent openings. Changing it also updates the next waiting turn.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm">Token budget <span className="sr-only">(optional)</span><Input type="number" min="1" max="1000000000000" step="1" placeholder="No limit" value={controls.token_budget ?? ""} onChange={event => update({ token_budget: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label className="grid gap-2 text-sm">Estimated cost budget (USD)<Input type="number" min="0" max="1000000" step="any" placeholder="No limit" value={controls.cost_budget_usd ?? ""} onChange={event => update({ cost_budget_usd: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
    </div>
    <label className="flex items-start gap-3 text-sm"><Checkbox  className="mt-0.5 size-4 " checked={controls.auto_pause} onCheckedChange={checked => update({ auto_pause: (checked === true) })} /><span>Pause automatically at a budget limit. Missing reported usage also pauses when a budget is enabled.</span></label>
    <p className="text-xs leading-relaxed text-muted-foreground">Budgets use cumulative reported input/output tokens and saved USD rates. Estimates exclude discounts and other charges. Limits are checked before further calls; active requests can exceed a threshold. With automatic pause off, limits show a reminder.</p>
    <Disclosure key={String(controls.cost_budget_usd !== undefined)} className="rounded-xl border border-border p-3" defaultOpen={controls.cost_budget_usd !== undefined ? true : undefined}>
      <DisclosureTrigger className="cursor-pointer text-sm font-medium">Cost rates · USD per 1M tokens</DisclosureTrigger><DisclosureContent>
      <p className="mt-2 text-xs text-muted-foreground">Rates are saved with this debate and apply to its cumulative estimate. Review catalog suggestions against your Provider plan.</p>
      <div className="mt-3 space-y-4">{seats.map((seat, index) => <div key={`${seat.provider_id}:${seat.model_id}`} className="space-y-2">
        <p className="break-all text-xs font-medium">Seat {index + 1} · {seat.model_id}</p>
        <div className="grid grid-cols-2 gap-3">{(["input_per_million", "output_per_million"] as const).map((key, rateIndex) => <label className="grid gap-1 text-xs" key={key}>{rateIndex ? "Output" : "Input"}<Input type="number" min="0" max="1000000" step="any" aria-label={`Seat ${index + 1} ${rateIndex ? "output" : "input"} rate`} placeholder="Unknown" value={controls.rates?.[index]?.[key] ?? ""} onChange={event => update({ rates: seats.map((_, i) => ({ ...controls.rates?.[i], ...(i === index ? { [key]: event.target.value === "" ? undefined : Number(event.target.value) } : {}) })) })} /></label>)}</div>
      </div>)}</div>
    </DisclosureContent></Disclosure>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function DebateUsageStrip({ usage, onEdit, focusMode = false }: { usage?: DebateUsage; onEdit: () => void; focusMode?: boolean }) {
  const budgetCopy = { token_budget: "Token budget reached", cost_budget: "Estimated cost budget reached", usage_missing: "Reported usage is incomplete", rates_missing: "Cost rates are missing" };
  const cost = usage && (usage.cost_complete || usage.estimated_cost_usd > 0) ? `${usage.estimated_cost_usd > 0 && usage.estimated_cost_usd < 0.0001 ? "<$0.0001" : `$${usage.estimated_cost_usd.toFixed(4)}`} estimated${usage.cost_complete ? "" : " · partial"}` : "Cost unavailable";
  return <div className="shrink-0 border-b border-border/60 bg-card px-5 py-1.5 text-xs sm:px-8" aria-label="Debate usage">
    <div className={focusMode ? "mx-auto max-w-5xl" : undefined}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="text-muted-foreground">{usage ? <>{usage.calls} calls · {(usage.input_tokens + usage.output_tokens).toLocaleString()} reported tokens · {cost}{usage.summary_calls > 0 ? ` · ${usage.summary_calls} ${usage.summary_calls === 1 ? "summary" : "summaries"}` : ""}{usage.active_calls > 0 ? ` · ${usage.active_calls} active` : ""}</> : "Usage not yet recorded"}</p>
      <Button size="xs" variant="ghost" onClick={onEdit}>Budget &amp; pace</Button>
    </div>
    {usage?.budget_status && <p className="mt-1 text-primary" role="status">{budgetCopy[usage.budget_status]} · Review budget settings to continue or adjust reminders.</p>}
    {!!usage?.missing_usage_calls && <p className="mt-1 text-muted-foreground">{usage.missing_usage_calls} calls have missing usage. Totals include only reported tokens.</p>}
    </div>
  </div>;
}
