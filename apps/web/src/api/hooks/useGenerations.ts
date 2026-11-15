import * as api from "@/api";
import { generationKeys } from "@/api/queryKeys";
import type {
  GenerationVerification,
  AttachmentInput,
} from "@cove/api-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateGenerationBatch() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      selection,
    }: {
      conversationId: string;
      selection: api.GenerationSelection;
    }) => api.createGenerationBatch(conversationId, selection),
    retry: false,
    onSuccess: (batch) => {
      cache.setQueryData(generationKeys.batch(batch.id), batch);
    },
  });
}

export function usePreviewAttachment() {
  return useMutation({
    mutationFn: (input: AttachmentInput) => api.previewAttachment(input),
    retry: false,
  });
}

export function usePreviewGenerationContext() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.previewGenerationContext>[0]) =>
      api.previewGenerationContext(input),
    retry: false,
  });
}

export function useCancelGenerationBatch() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelGenerationBatch(id),
    retry: false,
    onSuccess: (batch) => {
      cache.setQueryData(generationKeys.batch(batch.id), batch);
    },
  });
}

export function useRetryGenerationTarget() {
  return useMutation({
    mutationFn: ({
      targetId,
      clientRequestId,
    }: {
      targetId: string;
      clientRequestId: string;
    }) => api.retryGenerationTarget(targetId, clientRequestId),
    retry: false,
  });
}

export function useCancelGeneration() {
  return useMutation({
    mutationFn: (id: string) => api.cancelGeneration(id),
    retry: false,
  });
}

export function useSelectGenerationAnswer() {
  return useMutation({
    mutationFn: (id: string) => api.selectGenerationAnswer(id),
    retry: false,
  });
}

export function useSkipGenerationBatchContext() {
  return useMutation({
    mutationFn: (id: string) => api.skipGenerationBatchContext(id),
    retry: false,
  });
}

export function useMarkSecureGenerationEnvironment() {
  return useMutation({
    mutationFn: (id: string) => api.markSecureGenerationEnvironment(id),
    retry: false,
  });
}

export function useMarkSecureGenerationStreaming() {
  return useMutation({
    mutationFn: (id: string) => api.markSecureGenerationStreaming(id),
    retry: false,
  });
}

export function useMarkSecureGenerationResponseVerification() {
  return useMutation({
    mutationFn: (id: string) =>
      api.markSecureGenerationResponseVerification(id),
    retry: false,
  });
}

export function useSettleSecureGeneration() {
  return useMutation({
    mutationFn: ({
      id,
      body,
      verification,
    }: {
      id: string;
      body: string;
      verification: GenerationVerification;
    }) => api.settleSecureGeneration(id, body, verification),
    retry: false,
  });
}

export function useGenerationCache() {
  const cache = useQueryClient();
  return {
    loadContext: (id: string) =>
      cache.fetchQuery({
        queryKey: generationKeys.context(id),
        queryFn: () => api.getGenerationBatchContext(id),
        staleTime: Infinity,
        retry: false,
      }),
    loadBatch: (id: string) =>
      cache.fetchQuery({
        queryKey: generationKeys.batch(id),
        queryFn: () => api.getGenerationBatch(id),
        staleTime: 0,
        retry: false,
      }),
  };
}
