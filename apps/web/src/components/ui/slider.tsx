import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type SliderProps = Omit<
  ComponentProps<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
};

export function Slider({
  className,
  value,
  onValueChange,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-valuetext": valueText,
  id,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-6 w-full touch-none select-none items-center data-disabled:opacity-50",
        className,
      )}
      value={[value]}
      onValueChange={(values) => onValueChange(values[0])}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-disabled={props.disabled || undefined}
        id={id}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-valuetext={valueText}
        className="block size-4 rounded-full border-2 border-primary bg-card shadow-sm outline-none transition-shadow hover:ring-4 hover:ring-ring/15 focus-visible:ring-4 focus-visible:ring-ring/35 disabled:pointer-events-none"
      />
    </SliderPrimitive.Root>
  );
}
