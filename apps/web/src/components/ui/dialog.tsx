import { Dialog as DialogPrimitive } from "radix-ui";
import {
  createContext,
  useContext,
  useRef,
  type ComponentProps,
  type ElementType,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const DialogContext = createContext<{
  returnFocus: { current: HTMLElement | null };
  label?: string;
} | null>(null);

/** shadcn/Radix primitives with Cove's controlled dialog composition. */
export function Dialog({
  open,
  onClose,
  className,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContext.Provider value={{ returnFocus, label }}>
        <DialogPrimitive.Portal>
          <div data-slot="dialog-portal" className={className}>
            {children}
          </div>
        </DialogPrimitive.Portal>
      </DialogContext.Provider>
    </DialogPrimitive.Root>
  );
}

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-0 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  as: Tag,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { as?: ElementType }) {
  const context = useContext(DialogContext);
  const content = (
    <>
      {context?.label ? (
        <DialogPrimitive.Title className="sr-only">
          {context.label}
        </DialogPrimitive.Title>
      ) : null}
      {children}
    </>
  );
  return (
    <DialogPrimitive.Content
      data-slot="dialog-content"
      aria-describedby={undefined}
      asChild={Boolean(Tag)}
      className={cn(
        "relative z-50 border border-border bg-card text-card-foreground shadow-popover outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200",
        className,
      )}
      onInteractOutside={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-headlessui-portal]")
        )
          event.preventDefault();
        onInteractOutside?.(event);
      }}
      onOpenAutoFocus={(event) => {
        if (context)
          context.returnFocus.current =
            document.activeElement as HTMLElement | null;
        onOpenAutoFocus?.(event);
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        if (
          !event.defaultPrevented &&
          context?.returnFocus.current?.isConnected
        ) {
          event.preventDefault();
          context.returnFocus.current.focus();
        }
      }}
      {...props}
    >
      {Tag ? <Tag>{content}</Tag> : content}
    </DialogPrimitive.Content>
  );
}

export function DialogTitle({
  className,
  as: Tag,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title> & { as?: ElementType }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      asChild={Boolean(Tag)}
      className={cn("text-xl font-semibold tracking-tight", className)}
      {...props}
    >
      {Tag ? <Tag>{children}</Tag> : children}
    </DialogPrimitive.Title>
  );
}
