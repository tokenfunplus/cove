import { cn } from "@/lib/utils";

// Tailwind recipes for base presentation. Semantic colors come from theme/tokens.css.
export const baseStyles = {
  eyebrow: cn(String.raw`
    eyebrow text-muted-foreground text-[10px] font-[550] tracking-[0.02em]
  `),
  chatStatusLive: cn(String.raw`
    chat-status-live absolute w-[1px] h-[1px] overflow-hidden [clip-path:inset(50%)] whitespace-nowrap
  `),
} as const;
