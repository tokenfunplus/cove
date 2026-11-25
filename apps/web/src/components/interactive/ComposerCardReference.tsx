import type { ConversationView } from "@cove/api-contract";
import { Checkbox } from "@/components/ui/checkbox";
import { useComposerCard } from "@/hooks/chat/use-composer-card";

export function ComposerCardReference({
  view,
  disabled,
}: {
  view: ConversationView;
  disabled: boolean;
}) {
  const reference = useComposerCard(view, true);
  if (!reference) return null;
  return (
    <div className="mb-2 w-full min-w-0">
      <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={reference.included}
          disabled={disabled}
          onCheckedChange={(value) => reference.toggle(value === true)}
          aria-label="Include current card"
        />
        <span className="min-w-0 truncate" title={reference.title}>
          Include card (Send will save and lock it): {reference.title}
        </span>
      </label>
    </div>
  );
}
