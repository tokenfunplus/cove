import { type LiveTurn } from "@/lib/chat/live-turn";
import {
  type GenerationBatch,
  type GenerationBatchEvent,
} from "@cove/api-contract";
import { useRef, useState } from "react";

export function useGenerationState() {
  const [generationBatch, setGenerationBatch] = useState<GenerationBatch>();

  const [draft, setDraft] = useState("");

  const [liveTurn, setLiveTurn] = useState<LiveTurn>();

  const [isSending, setIsSending] = useState(false);

  const [resumeGenerationBatch, setResumeGenerationBatch] =
    useState<GenerationBatch>();

  const secureInferenceAbortRef = useRef<AbortController | undefined>(
    undefined,
  );

  const secureInferenceFinishedRef = useRef<Promise<unknown> | undefined>(
    undefined,
  );

  const secureGenerationRunsRef = useRef(
    new Map<
      string,
      { batchID: string; controller: AbortController; finished: Promise<void> }
    >(),
  );

  const pendingBatchEventsRef = useRef<GenerationBatchEvent[]>([]);

  const streamingFrameRef = useRef<number | undefined>(undefined);

  return {
    generationBatch,
    setGenerationBatch,
    draft,
    setDraft,
    liveTurn,
    setLiveTurn,
    isSending,
    setIsSending,
    resumeGenerationBatch,
    setResumeGenerationBatch,
    secureInferenceAbortRef,
    secureInferenceFinishedRef,
    secureGenerationRunsRef,
    pendingBatchEventsRef,
    streamingFrameRef,
  };
}

export type GenerationState = ReturnType<typeof useGenerationState>;
