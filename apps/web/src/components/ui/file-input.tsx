import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// File selection still uses the OS picker; visible triggers use the shared Button.
export function FileInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="file" data-slot="file-input" tabIndex={-1} className={cn("sr-only", className)} {...props} />;
}
