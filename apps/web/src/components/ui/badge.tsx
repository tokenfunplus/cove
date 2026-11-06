import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-[10px] font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-accent text-accent-foreground",
        outline: "border-border text-muted-foreground",
        destructive: "bg-destructive-muted text-destructive",
        peach: "bg-peach text-peach-foreground",
        rose: "bg-rose text-rose-foreground",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);
export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
