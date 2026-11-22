import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Progress({ value, max = 100, className, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100;
  const bounded = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(limit, value));
  return (
    <ProgressPrimitive.Root data-slot="progress" value={bounded} max={limit} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)} {...props}>
      <ProgressPrimitive.Indicator className={cn("h-full rounded-full bg-primary transition-transform motion-reduce:transition-none", bounded == null ? "w-1/3 animate-pulse motion-reduce:animate-none" : "w-full")} style={bounded == null ? undefined : { transform: `translateX(-${100 - (bounded / limit) * 100}%)` }} />
    </ProgressPrimitive.Root>
  );
}
