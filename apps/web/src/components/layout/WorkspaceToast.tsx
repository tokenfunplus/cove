import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type WorkspaceFeedback } from "@/hooks/workspace/use-workspace-ui";

export function WorkspaceToast({
  feedback,
  onDismiss,
}: {
  feedback: WorkspaceFeedback;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timeout = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timeout);
  }, [feedback, hovered, focused, onDismiss]);

  const Icon = { error: CircleAlert, info: Info, success: CheckCircle2 }[
    feedback.tone
  ];
  return (
    <div
      className="workspace__feedback absolute top-3 right-3 z-50 flex w-max max-w-[calc(100%-1.5rem)] items-start gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-5 text-foreground shadow-popover sm:max-w-sm"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <Icon
        aria-hidden="true"
        size={16}
        data-tone={feedback.tone}
        className="mt-0.5 shrink-0 text-primary data-[tone=error]:text-destructive data-[tone=success]:text-success"
      />
      <span role="status" className="min-w-0 break-words">
        {feedback.message}
      </span>
      <Button
        type="button"
        variant="ghost"
        aria-label="Dismiss notification"
        className="-mr-1 size-6 shrink-0 p-0 text-muted-foreground"
        onClick={() => onDismiss()}
      >
        <X aria-hidden="true" size={14} />
      </Button>
    </div>
  );
}
