import { type ApplicationCopy } from "@/messages";
import { type Conversation } from "@cove/api-contract";

type ConversationGroup = {
  id: "pinned" | "today" | "previous7Days" | "older";
  label: (copy: ApplicationCopy) => string;
  conversations: Conversation[];
};

export function groupConversations(
  conversations: Conversation[],
  includePinned = true,
): ConversationGroup[] {
  const buckets: Record<ConversationGroup["id"], Conversation[]> = {
    pinned: [],
    today: [],
    previous7Days: [],
    older: [],
  };
  const today = startOfLocalDay(new Date());

  for (const conversation of conversations) {
    if (includePinned && conversation.pinned) {
      buckets.pinned.push(conversation);
      continue;
    }
    const updated = startOfLocalDay(new Date(conversation.updated_at));
    const ageInDays = Math.floor(
      (today.getTime() - updated.getTime()) / 86_400_000,
    );
    const group =
      ageInDays <= 0 ? "today" : ageInDays <= 7 ? "previous7Days" : "older";
    buckets[group].push(conversation);
  }

  const definitions: Array<Pick<ConversationGroup, "id" | "label">> = [
    ...(includePinned
      ? [
          {
            id: "pinned" as const,
            label: (copy: ApplicationCopy) => copy.pinned,
          },
        ]
      : []),
    { id: "today", label: (copy) => copy.today },
    { id: "previous7Days", label: (copy) => copy.previous7Days },
    { id: "older", label: (copy) => copy.older },
  ];
  return definitions
    .filter(({ id }) => buckets[id].length > 0)
    .map(({ id, label }) => ({ id, label, conversations: buckets[id] }));
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
