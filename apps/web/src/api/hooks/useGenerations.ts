import * as api from "@/api";
import { conversationKeys, generationKeys } from "@/api/queryKeys";
import type {
  GenerationVerification,
  GenerationMetrics,
  AttachmentInput,
  ConversationView,
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
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.previewGenerationContext>[0]) =>
      api.previewGenerationContext(input),
    onSuccess: (preview, input) => {
      if (Array.isArray(preview)) return;
      const expected = preview.expected_project;
      cache.setQueryData<ConversationView>(
        conversationKeys.detail(input.conversationId),
        (view) => {
          if (
            !view ||
            expected.membership_revision < (view.membership_revision ?? 0)
          ) return view;
          if (
            expected.membership_revision === (view.membership_revision ?? 0) &&
            expected.project_id === (view.project_id ?? "") &&
            expected.project_revision < (view.project_revision ?? 0)
          ) return view;
          return {
            ...view,
            project_id: expected.project_id || undefined,
            project_revision: expected.project_revision,
            membership_revision: expected.membership_revision,
          };
        },
      );
    },
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
      localOnly,
    }: {
      localOnly?: boolean;
      targetId: string;
      clientRequestId: string;
    }) => localOnly ? api.retryGenerationTarget(targetId, clientRequestId, true) : api.retryGenerationTarget(targetId, clientRequestId),
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
      metrics,
      reasoning,
    }: {
      id: string;
      body: string;
      verification: GenerationVerification;
      metrics?: GenerationMetrics;
      reasoning?: string;
    }) =>
      reasoning === undefined
        ? api.settleSecureGeneration(id, body, verification, metrics)
        : api.settleSecureGeneration(
            id,
            body,
            verification,
            metrics,
            reasoning,
          ),
    retry: false,
  });
}

export function useGenerationCache() {
  const cache = useQueryClient();
  return {
    loadProjectContext: (id:string) => cache.fetchQuery({
      queryKey:generationKeys.projectContext(id),queryFn:()=>api.getProjectBatchContext(id),staleTime:Infinity,retry:false,
    }),
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
