import { cn } from "@/lib/utils";

// Tailwind recipes for motion presentation. Semantic colors come from theme/tokens.css.
export const motionStyles = {
  pendingDots: cn(String.raw`
    pending-dots animate-[cove-breathe_1.4s_ease-in-out_infinite]
  `),
} as const;
