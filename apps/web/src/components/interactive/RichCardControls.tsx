import { useRef, useState } from "react";
import type { CardOption } from "@cove/api-contract";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

export function RankingControl({
  label,
  options,
  value,
  locked,
  onChange,
}: {
  label: string;
  options: CardOption[];
  value: string[];
  locked: boolean;
  onChange: (value: string[]) => void;
}) {
  const dragged = useRef<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  function move(item: string, index: number) {
    const from = value.indexOf(item);
    if (
      locked ||
      from < 0 ||
      index < 0 ||
      index >= value.length ||
      from === index
    )
      return;
    const next = [...value];
    next.splice(from, 1);
    next.splice(index, 0, item);
    onChange(next);
    setAnnouncement(
      `${options.find((o) => o.value === item)?.label} moved to position ${index + 1}.`,
    );
  }
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {!locked && (
        <p className="text-xs text-muted-foreground">
          Drag to reorder, or use the arrow buttons.
        </p>
      )}
      <ol aria-label={label} className="grid gap-2">
        {value.map((item, index) => {
          const option = options.find((o) => o.value === item)!;
          return (
            <li
              key={item}
              draggable={!locked}
              onDragStart={(e) => {
                if (locked) {
                  e.preventDefault();
                  return;
                }
                dragged.current = item;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item);
              }}
              onDragEnd={() => {
                dragged.current = undefined;
              }}
              onDragOver={(e) => {
                if (!locked && dragged.current) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged.current) move(dragged.current, index);
                dragged.current = undefined;
              }}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background p-3"
            >
              <span
                aria-hidden="true"
                className="text-sm font-semibold text-muted-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 break-words text-sm">
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <p className="mt-1 text-muted-foreground">
                    {option.description}
                  </p>
                )}
              </div>
              {!locked && (
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${option.label} up`}
                    disabled={index === 0}
                    onClick={() => move(item, index - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${option.label} down`}
                    disabled={index === value.length - 1}
                    onClick={() => move(item, index + 1)}
                  >
                    ↓
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </fieldset>
  );
}

export function SliderControl({
  label,
  unit = "",
  value,
  minimum,
  maximum,
  step,
  locked,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  locked: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <output aria-label={`${label} value`}>
          {value} {unit}
        </output>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Decrease ${label}`}
          disabled={locked || value <= minimum}
          onClick={() => onChange(value - step)}
        >
          −
        </Button>
        <Slider
          aria-label={label}
          aria-valuetext={`${value} ${unit}`.trim()}
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          disabled={locked}
          onValueChange={onChange}
        />
        <Button
          variant="outline"
          size="sm"
          aria-label={`Increase ${label}`}
          disabled={locked || value >= maximum}
          onClick={() => onChange(value + step)}
        >
          +
        </Button>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {minimum} {unit}
        </span>
        <span>
          {maximum} {unit}
        </span>
      </div>
    </div>
  );
}

export function AllocationControl({
  label,
  sum,
  total,
  remaining,
  unit,
}: {
  label: string;
  sum: number;
  total: number;
  remaining: number;
  unit: string;
}) {
  return (
    <div
      className="grid gap-2 rounded-xl border border-border bg-accent p-3 text-sm"
      role="group"
      aria-label={label}
    >
      <strong>{label}</strong>
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          Allocated: {sum} / {total} {unit}
        </span>
        <output
          aria-label={`${label} balance`}
          className={
            remaining < 0 ? "font-medium text-destructive" : "font-medium"
          }
        >
          {remaining < 0 ? `Over by ${-remaining}` : `Remaining: ${remaining}`}{" "}
          {unit}
        </output>
      </div>
      <progress
        aria-label={`${label} allocated`}
        max={Math.max(total, 1)}
        value={Math.max(0, Math.min(sum, total))}
        className="h-2 w-full accent-primary"
      />
    </div>
  );
}

export function TextEditorControl({
  id,
  label,
  placeholder,
  value,
  maxLength,
  locked,
  invalid,
  errorId,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  maxLength: number;
  locked: boolean;
  invalid: boolean;
  errorId?: string;
  canUndo: boolean;
  canRedo: boolean;
  onChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={locked}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        rows={5}
        onChange={(e) =>
          onChange([...e.target.value].slice(0, maxLength).join(""))
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {[...value].length} / {maxLength}
        </span>
        {!locked && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canUndo}
              onClick={onUndo}
            >
              Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canRedo}
              onClick={onRedo}
            >
              Redo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
