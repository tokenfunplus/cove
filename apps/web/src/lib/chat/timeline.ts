import type { ConversationView } from "@cove/api-contract";
import type { LiveTurn } from "@/lib/chat/live-turn";

export type TimelineEntry = { id: string; title: string; excerpt: string };

export function summarize(text: string, limit: number) {
  const plain = text
    .slice(0, 2000)
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(.*?)\1/g, "$2")
    .replace(/^ {0,3}(?:#{1,6}|>|[-*+])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  return characters.length > limit ? characters.slice(0, limit).join("") + "…" : plain;
}

/** One position per user turn; comparison answers share their prompt's position. */
export function conversationTimeline(
  view?: ConversationView,
  liveTurn?: LiveTurn,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const message of view?.messages ?? []) {
    if (message.role === "user") {
      entries.push({ id: message.id, title: summarize(message.body, 72), excerpt: "" });
    } else if (message.role === "assistant" && entries.length) {
      const entry = entries[entries.length - 1];
      if (!entry.excerpt) entry.excerpt = summarize(message.body, 200);
    }
  }
  if (liveTurn && liveTurn.conversationId === view?.id && liveTurn.userMessageId) {
    let entry = entries.find((item) => item.id === liveTurn.userMessageId);
    if (!entry) {
      entry = {
        id: liveTurn.userMessageId,
        title: summarize(liveTurn.userBody, 72),
        excerpt: "",
      };
      entries.push(entry);
    }
    if (!entry.excerpt) {
      entry.excerpt = summarize(
        liveTurn.targets?.find((target) => target.assistantBody)?.assistantBody ??
          liveTurn.assistantBody ?? "",
        200,
      );
    }
  }
  return entries;
}
