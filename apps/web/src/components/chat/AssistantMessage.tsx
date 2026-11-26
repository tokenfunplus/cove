import { cardBlock } from "@cove/api-contract";
import {
  Disclosure,
  DisclosureTrigger,
  DisclosureContent,
} from "@/components/ui/disclosure";
import { SourceReferences } from "./SourceReferences";
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
  interactive = false,
}: {
  content: string;
  reasoning?: string;
  streaming?: boolean;
  interactive?: boolean;
}) {
  const parsed = splitReasoning(content, streaming);
  const reasoning = structuredReasoning || parsed.reasoning;
  const rawAnswer = structuredReasoning ? content : parsed.answer;
  const pendingCard = interactive ? cardBlock(rawAnswer) : undefined;
  const answer = pendingCard?.prose ?? rawAnswer;
  return (
    <div className={messagesStyles.assistantContent}>
      {reasoning !== undefined && (reasoning.trim() || streaming) ? (
        <ReasoningBlock
          key={streaming ? "streaming" : "settled"}
          content={reasoning}
          streaming={streaming}
        />
      ) : null}
      {pendingCard && (
        <p role="status" className="my-3 text-sm text-muted-foreground">
          {streaming
            ? "Preparing an interactive reply…"
            : pendingCard.complete
              ? "Loading interactive reply…"
              : "This interactive reply did not finish. You can ask to try again."}
        </p>
      )}
      {answer ? <MarkdownMessage content={answer} /> : null}
      {!streaming && answer && <SourceReferences content={answer} />}
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
    <Disclosure
      data-reasoning
      className={messagesStyles.reasoning}
      open={open}
      onOpenChange={setOpen}
    >
      <DisclosureTrigger
        showChevron={false}
        className={messagesStyles.reasoningSummary}
      >
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
      </DisclosureTrigger>
      <DisclosureContent>
        <div className={messagesStyles.reasoningBody}>
          <MarkdownMessage content={content} />
        </div>
      </DisclosureContent>
    </Disclosure>
  );
}
