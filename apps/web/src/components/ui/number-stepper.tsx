import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function NumberStepper({
  id,
  label,
  describedBy,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onValueChange,
  className,
}: {
  id: string;
  label: string;
  describedBy?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  function update(next: number) {
    const bounded = Math.max(min, Math.min(max, next));
    setDraft(String(bounded));
    onValueChange(bounded);
  }

  return (
    <div className={cn("inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl border border-input bg-popover p-0.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/15", className)}>
      <Button type="button" variant="ghost" size="icon-xs" className="size-7 rounded-lg text-muted-foreground" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => update(value - step)}><Minus className="size-3.5" aria-hidden="true" /></Button>
      <Input
        id={id}
        role="spinbutton"
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        disabled={disabled}
        value={draft}
        className="h-7 w-11 rounded-none border-0 bg-transparent p-0 text-center text-[13px] font-medium tabular-nums focus-visible:bg-transparent focus-visible:ring-0"
        onFocus={() => setEditing(true)}
        onChange={event => {
          const next = event.target.value;
          if (!/^\d*$/.test(next)) return;
          setDraft(next);
          const parsed = Number(next);
          if (next && parsed >= min && parsed <= max) onValueChange(parsed);
        }}
        onBlur={() => {
          setEditing(false);
          update(draft ? Number(draft) : value);
        }}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            update(draft ? Number(draft) : value);
            return;
          }
          const next = event.key === "ArrowUp" ? value + step : event.key === "ArrowDown" ? value - step : event.key === "Home" ? min : event.key === "End" ? max : undefined;
          if (next !== undefined) { event.preventDefault(); update(next); }
        }}
      />
      <Button type="button" variant="ghost" size="icon-xs" className="size-7 rounded-lg text-muted-foreground" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => update(value + step)}><Plus className="size-3.5" aria-hidden="true" /></Button>
    </div>
  );
}
