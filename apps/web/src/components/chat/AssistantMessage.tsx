import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { splitReasoning } from "@/lib/chat/reasoning";
import { englishConversationCopy } from "@/messages";
import { messagesStyles } from "@/styles/messages";

export const AssistantMessage = memo(function AssistantMessage({
  content,
  reasoning: structuredReasoning,
  streaming = false,
}: {
  content: string;
  reasoning?: string;
  streaming?: boolean;
}) {
  const parsed = splitReasoning(content, streaming);
  const reasoning = structuredReasoning || parsed.reasoning;
  const answer = structuredReasoning ? content : parsed.answer;
  return (
    <div className={messagesStyles.assistantContent}>
      {reasoning !== undefined && (reasoning.trim() || streaming) ? (
        <ReasoningBlock
          key={streaming ? "streaming" : "settled"}
          content={reasoning}
          streaming={streaming}
        />
      ) : null}
      {answer ? <MarkdownMessage content={answer} /> : null}
    </div>
  );
});

function ReasoningBlock({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(streaming);
  return (
    <details
      data-reasoning
      className={messagesStyles.reasoning}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={messagesStyles.reasoningSummary}>
        <ChevronRight
          aria-hidden="true"
          size={14}
          className={messagesStyles.reasoningChevron}
        />
        <span>{englishConversationCopy.reasoning}</span>
        {streaming ? (
          <span className={messagesStyles.reasoningStatus}>
            {englishConversationCopy.reasoningStreaming}
          </span>
        ) : null}
      </summary>
      <div className={messagesStyles.reasoningBody}>
        <MarkdownMessage content={content} />
      </div>
    </details>
  );
}
