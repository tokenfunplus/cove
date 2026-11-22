import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-2", className)} {...props} />;
}

export function RadioCard({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item data-slot="radio-card" className={cn("group/radio relative cursor-pointer rounded-lg border border-border p-2 text-left outline-none transition-colors data-[state=checked]:border-primary focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />;
}
