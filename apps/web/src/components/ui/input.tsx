import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-11 w-full min-w-0 rounded-2xl border border-input bg-muted/70 px-3 py-2 text-sm text-foreground shadow-none outline-none transition-[color,box-shadow,border-color,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}
