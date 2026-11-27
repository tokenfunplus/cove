import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { interactiveStyles as styles } from "@/styles/interactive";
import { useReorderMotion } from "@/hooks/chat/use-reorder-motion";
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
  const [dragging, setDragging] = useState<string>();
  const list = useRef<HTMLOListElement>(null);
  const pointer = useRef<number | undefined>(undefined);
  const motion = useReorderMotion(value);
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
    motion.capture(dragged.current);
    onChange(next);
    setAnnouncement(
      `${options.find((o) => o.value === item)?.label} moved to position ${index + 1}.`,
    );
  }
  function stopDragging() {
    pointer.current = undefined;
    dragged.current = undefined;
    setDragging(undefined);
  }
  return (
    <fieldset className={styles.ranking}>
      <legend className="text-sm font-medium">{label}</legend>
      {!locked && (
        <p className="text-xs text-muted-foreground">
          Drag to reorder, or use the arrow buttons.
        </p>
      )}
      <ol
        ref={list}
        aria-label={label}
        className={styles.rankingList}
        onPointerMove={(event) => {
          const item = dragged.current;
          if (!item || pointer.current !== event.pointerId || locked) return;
          const target = document
            .elementFromPoint?.(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-ranking-item]");
          if (!target || !list.current?.contains(target)) return;
          move(item, value.indexOf(target.dataset.rankingItem!));
        }}
        onPointerUp={(event) => {
          if (pointer.current === event.pointerId) stopDragging();
        }}
        onPointerCancel={(event) => {
          if (pointer.current === event.pointerId) stopDragging();
        }}
        onLostPointerCapture={(event) => {
          if (pointer.current === event.pointerId) stopDragging();
        }}
      >
        {value.map((item, index) => {
          const option = options.find((o) => o.value === item)!;
          return (
            <li
              key={item}
              data-ranking-item={item}
              data-dragging={!locked && dragging === item}
              ref={(row) => {
                if (row) motion.rows.current.set(item, row);
                else motion.rows.current.delete(item);
              }}
              draggable={!locked}
              onDragStart={(e) => {
                if (locked) {
                  e.preventDefault();
                  return;
                }
                dragged.current = item;
                setDragging(item);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item);
              }}
              onDragEnd={() => {
                dragged.current = undefined;
                setDragging(undefined);
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
                setDragging(undefined);
              }}
              className={styles.rankingItem}
            >
              <span aria-hidden="true" className={styles.rankingNumber}>
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
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={styles.dragHandle}
                    aria-label={`Drag ${option.label} to reorder`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                        return;
                      event.preventDefault();
                      move(item, index + (event.key === "ArrowUp" ? -1 : 1));
                    }}
                    onPointerDown={(event) => {
                      if (
                        event.button !== 0 ||
                        event.isPrimary === false ||
                        locked
                      )
                        return;
                      event.preventDefault();
                      event.currentTarget.focus({ preventScroll: true });
                      pointer.current = event.pointerId;
                      dragged.current = item;
                      setDragging(item);
                      list.current?.setPointerCapture?.(event.pointerId);
                    }}
                  >
                    <GripVertical aria-hidden="true" />
                  </Button>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${option.label} up`}
                      disabled={index === 0}
                      onClick={() => move(item, index - 1)}
                    >
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${option.label} down`}
                      disabled={index === value.length - 1}
                      onClick={() => move(item, index + 1)}
                    >
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                </>
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
    <div className={styles.slider} data-card-control="slider">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <output aria-label={`${label} value`} className={styles.sliderValue}>
          {value} {unit}
        </output>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className={styles.stepButton}
          aria-label={`Decrease ${label}`}
          disabled={locked || value <= minimum}
          onClick={() => onChange(value - step)}
        >
          −
        </Button>
        <Slider
          className={styles.sliderTrack}
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
          className={styles.stepButton}
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
  const percent = Math.round(
    Math.max(0, Math.min(sum / Math.max(total, 1), 1)) * 100,
  );
  return (
    <div
      className={styles.allocation}
      data-over={remaining < 0}
      role="group"
      aria-label={label}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-40 space-y-2">
          <strong className="text-xs font-medium text-muted-foreground">
            {label}
          </strong>
          <output
            aria-label={`${label} balance`}
            className={styles.balance}
            data-over={remaining < 0}
          >
            {remaining < 0
              ? `Over by ${-remaining}`
              : `Remaining: ${remaining}`}{" "}
            {unit}
          </output>
          <p className="text-xs text-muted-foreground">
            Allocated: {sum} / {total} {unit}
          </p>
        </div>
        <div
          className={styles.gauge}
          data-over={remaining < 0}
          aria-hidden="true"
        >
          <svg viewBox="0 0 100 100" className={styles.gaugeSvg}>
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              opacity="0.12"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - percent}
              className={styles.gaugeFill}
            />
          </svg>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {percent}%
          </span>
        </div>
      </div>
      <progress
        aria-label={`${label} allocated`}
        max={Math.max(total, 1)}
        value={Math.max(0, Math.min(sum, total))}
        className={styles.progress}
        data-over={remaining < 0}
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
    <div className={styles.editor}>
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
              <RotateCcw aria-hidden="true" className="size-3.5" /> Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <RotateCw aria-hidden="true" className="size-3.5" /> Redo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
