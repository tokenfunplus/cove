import { Collapsible } from "radix-ui";
import { ChevronRight } from "lucide-react";
import { createContext, useContext, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

const DisclosureContext = createContext(false);

export function Disclosure({ open, defaultOpen = false, onOpenChange, ...props }: ComponentProps<typeof Collapsible.Root>) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const visible = open ?? expanded;
  return (
    <DisclosureContext.Provider value={visible}>
      <Collapsible.Root data-slot="disclosure" open={visible} onOpenChange={value => { if (open === undefined) setExpanded(value); onOpenChange?.(value); }} {...props} />
    </DisclosureContext.Provider>
  );
}

export function DisclosureTrigger({ className, children, showChevron = true, ...props }: ComponentProps<typeof Collapsible.Trigger> & { showChevron?: boolean }) {
  return (
    <Collapsible.Trigger data-slot="disclosure-trigger" className={cn("group/disclosure-trigger flex w-full min-w-0 items-center gap-2 rounded-md text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>
      {showChevron && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/disclosure-trigger:rotate-90 motion-reduce:transition-none" aria-hidden="true" />}
      {children}
    </Collapsible.Trigger>
  );
}

export function DisclosureContent({ className, ...props }: ComponentProps<typeof Collapsible.Content>) {
  const open = useContext(DisclosureContext);
  // Keep expensive report and source content mounted, as native details did.
  return <Collapsible.Content data-slot="disclosure-content" forceMount hidden={!open} className={cn("min-w-0", className)} {...props} />;
}
