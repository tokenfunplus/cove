import { useWorkspaceActive } from "@/lib/workspace-active";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useRef, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  children,
  content,
  side = "top",
  className,
  suppressRestoredFocus = false,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
  className?: string;
  suppressRestoredFocus?: boolean;
}) {
  const active = useWorkspaceActive();
  const activated = useRef(false);
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={100}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger
          asChild
          onClick={() => { if (suppressRestoredFocus) activated.current = true; }}
          onFocus={event => {
            // Returning from a modal should preserve the next Escape for its parent view.
            if (activated.current) { activated.current = false; event.preventDefault(); }
          }}
        >{children}</TooltipPrimitive.Trigger>
        {active && <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={12}
            className={cn(
              "z-[120] max-w-[min(280px,calc(100vw-24px))] rounded-xl border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-popover animate-in fade-in-0 zoom-in-95",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
