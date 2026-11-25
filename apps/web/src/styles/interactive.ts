import { cn } from "@/lib/utils";
export const interactiveStyles = {
  card: cn(
    "my-4 min-w-0 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm [&_p]:whitespace-pre-wrap [&_p]:break-words",
  ),
  stack: cn("grid gap-4"),
  title: cn("text-base font-semibold leading-snug"),
  hint: cn("text-xs text-muted-foreground"),
  feedback: cn("rounded-xl border border-border bg-accent p-3 text-sm"),
  footer: cn(
    "mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3",
  ),
};
