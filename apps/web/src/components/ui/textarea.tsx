import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full min-w-0 resize-y rounded-2xl border border-input bg-muted/70 px-3 py-3 text-sm leading-relaxed text-foreground outline-none transition-[color,box-shadow,border-color,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}
