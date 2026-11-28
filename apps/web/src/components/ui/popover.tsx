import { useWorkspaceActive } from "@/lib/workspace-active";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 8,
  collisionPadding = 14,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const active = useWorkspaceActive();
  if (!active) return null;
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-[110] max-h-(--radix-popover-content-available-height) w-[min(320px,calc(100vw-28px))] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-popover outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
