import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cardBlock, type ConversationView } from "@cove/api-contract";
import { interactiveCardQuery } from "./use-interactive-card";
import { setComposerCard } from "@/lib/chat/interactive-context";

export function useComposerCard(view: ConversationView, enabled: boolean) {
  const owner = useId();
  const client = useQueryClient();
  const [includedSource, setIncludedSource] = useState<string>();
  const tail = [...(view.generation_batches ?? [])]
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
    .at(-1);
  const answer = tail?.selected_answer;
  const content = view.messages.find(
    (m) => m.id === answer?.assistant_message_id,
  )?.body;
  const source =
    enabled &&
    !view.archived &&
    tail?.interactive &&
    tail.targets.length === 1 &&
    content &&
    cardBlock(content)
      ? answer?.generation_id
      : undefined;
  const query = useQuery({
    ...interactiveCardQuery(client, source ?? ""),
    enabled: Boolean(source),
  });
  const eligible = Boolean(
    source && query.data?.can_continue && !query.data.submitted_batch_id,
  );
  const included = eligible && includedSource === source;
  useEffect(
    () => setComposerCard(view.id, owner, eligible ? source! : "", included),
    [view.id, owner, source, eligible, included],
  );
  if (!eligible || !source || !query.data) return;
  const definition = query.data.definition;
  const title = definition.spec.elements[definition.spec.root]?.props.title;
  return {
    title: typeof title === "string" ? title : "Current card",
    included,
    toggle(value: boolean) {
      setIncludedSource(value ? source : undefined);
      setComposerCard(view.id, owner, source, value);
    },
  };
}
