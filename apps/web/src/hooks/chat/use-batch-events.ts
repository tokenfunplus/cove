import { subscribeGenerationBatch } from "@/api";
import { useConversationCache } from "@/api/hooks/useConversations";
import { useGenerationCache } from "@/api/hooks/useGenerations";
import { type GenerationState } from "@/hooks/chat/use-generation-state";
import { type WorkspaceState } from "@/hooks/workspace/use-workspace-state";
import { type WorkspaceUi } from "@/hooks/workspace/use-workspace-ui";
import {
  applyLiveTurnEvent,
  hydrateLiveTurnBatch,
  reconcileLiveTurn,
} from "@/lib/chat/live-turn";
import { type ApplicationCopy } from "@/messages";
import {
  type GenerationBatch,
  type GenerationBatchEvent,
} from "@cove/api-contract";

type Dependencies = Pick<
  GenerationState,
  | "streamingFrameRef"
  | "pendingBatchEventsRef"
  | "setLiveTurn"
  | "setGenerationBatch"
  | "setIsSending"
> &
  Pick<WorkspaceState, "selectedIdRef" | "setConversationView"> &
  Pick<WorkspaceUi, "setFeedback" | "showingArchived"> & {
    copy: ApplicationCopy;
  };

export function useBatchEvents({
  streamingFrameRef,
  pendingBatchEventsRef,
  setLiveTurn,
  selectedIdRef,
  setGenerationBatch,
  setFeedback,
  copy,
  showingArchived,
  setConversationView,
  setIsSending,
}: Dependencies) {
  const {
    loadConversation: getConversation,
    loadConversations: getConversations,
  } = useConversationCache();
  const { loadBatch: getGenerationBatch } = useGenerationCache();

  function flushPendingBatchEvents() {
    if (streamingFrameRef.current !== undefined) {
      if (typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(streamingFrameRef.current);
      else window.clearTimeout(streamingFrameRef.current);
      streamingFrameRef.current = undefined;
    }
    const events = pendingBatchEventsRef.current;
    pendingBatchEventsRef.current = [];
    if (events.length > 0)
      setLiveTurn((current) =>
        current ? events.reduce(applyLiveTurnEvent, current) : current,
      );
  }

  function queueBatchDelta(event: GenerationBatchEvent) {
    pendingBatchEventsRef.current.push(event);
    if (streamingFrameRef.current !== undefined) return;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 16);
    streamingFrameRef.current = schedule(() => {
      streamingFrameRef.current = undefined;
      flushPendingBatchEvents();
    });
  }

  async function streamGenerationBatch(next: GenerationBatch) {
    const ownsConversation = () =>
      selectedIdRef.current === next.conversation_id;
    if (ownsConversation()) setGenerationBatch(next);
    let finalBatch: GenerationBatch | undefined;
    try {
      for await (const event of subscribeGenerationBatch(next.id)) {
        if (!ownsConversation()) continue;
        if (event.type === "delta") queueBatchDelta(event);
        else {
          flushPendingBatchEvents();
          setLiveTurn((current) =>
            current ? applyLiveTurnEvent(current, event) : current,
          );
        }
      }
      flushPendingBatchEvents();
      finalBatch = await getGenerationBatch(next.id);
      if (ownsConversation()) {
        setGenerationBatch(finalBatch);
        setLiveTurn((current) =>
          current ? hydrateLiveTurnBatch(current, finalBatch!) : current,
        );
      }
    } catch {
      flushPendingBatchEvents();
      if (ownsConversation()) {
        setFeedback(copy.generationUnavailable);
        setLiveTurn((current) =>
          current
            ? {
                ...current,
                targets: (current.targets ?? []).map((target) => ({
                  ...target,
                  phase:
                    target.phase === "pending" ||
                    target.phase === "verifying_environment" ||
                    target.phase === "streaming" ||
                    target.phase === "verifying_response"
                      ? "unknown"
                      : target.phase,
                })),
              }
            : current,
        );
      }
    } finally {
      if (!ownsConversation()) return;
      const [refreshed] = await Promise.all([
        getConversation(next.conversation_id).catch(() => undefined),
        getConversations({ archived: showingArchived }).catch(() => undefined),
      ]);
      if (refreshed && selectedIdRef.current === next.conversation_id) {
        setConversationView(refreshed);
        const authoritativeBatch =
          refreshed.generation_batches?.find((batch) => batch.id === next.id) ??
          finalBatch;
        if (authoritativeBatch) {
          setLiveTurn((current) =>
            current
              ? reconcileLiveTurn(
                  hydrateLiveTurnBatch(current, authoritativeBatch),
                  refreshed,
                )
              : current,
          );
        }
      }

      if (ownsConversation()) setIsSending(false);
    }
  }

  return { flushPendingBatchEvents, queueBatchDelta, streamGenerationBatch };
}

export type BatchEvents = ReturnType<typeof useBatchEvents>;
