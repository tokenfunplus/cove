import type {
  ConversationView,
  GenerationBatch,
  GenerationBatchEvent,
  ProviderProfile,
  WorkspaceSettings,
} from "@cove/api-contract";

const timestamp = "2026-11-06T00:00:00Z";

export function createWorkspaceFixture(targetCount = 1) {
  const conversation: ConversationView = {
    id: "conversation-one",
    title: "First chat",
    messages: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  const secondConversation: ConversationView = {
    ...conversation,
    id: "conversation-two",
    title: "Second chat",
  };
  const profile: ProviderProfile = {
    id: "provider-one",
    kind: "openai_compatible",
    name: "Test Provider",
    endpoint: "https://provider.example",
    model_id: "model-one",
    auth_method: "bearer",
    configured: true,
    runtime_location: "Test cloud",
    destination: "provider.example",
    transport_security: "tls",
    privacy_notice: "Synthetic test provider.",
    created_at: timestamp,
    updated_at: timestamp,
  };
  const models = ["model-one", "model-two"].slice(0, targetCount);
  const settings: WorkspaceSettings = {
    theme: "light",
    locale: "en",
    system_prompt: "",
    temperature: null,
    top_p: null,
    max_tokens: null,
    active_model_set: models.map((model) => ({
      provider_id: profile.id,
      model_id: model,
    })),
  };
  const pendingBatch: GenerationBatch = {
    id: "batch-one",
    conversation_id: conversation.id,
    client_request_id: "request-one",
    user_message_id: "user-one",
    state: "pending",
    events_url: "/unused-test-stream",
    created_at: timestamp,
    updated_at: timestamp,
    targets: models.map((model, position) => ({
      id: `target-${position}`,
      provider_id: profile.id,
      model_id: model,
      position,
      generation: {
        id: `generation-${position}`,
        state: "pending",
        snapshot: {
          provider_id: profile.id,
          provider_name: profile.name,
          model_id: model,
          runtime_location: profile.runtime_location,
          destination: profile.destination,
          transport_security: profile.transport_security,
          privacy_notice: profile.privacy_notice,
        },
        configuration_snapshot: {
          system_prompt: "",
          temperature: null,
          top_p: null,
          max_tokens: null,
        },
      },
    })),
  };
  const completedBatch: GenerationBatch = {
    ...pendingBatch,
    state: "completed",
    targets: pendingBatch.targets.map((target) => ({
      ...target,
      generation: {
        ...target.generation,
        state: "completed",
        assistant_message_id: `answer-${target.position}`,
      },
    })),
  };
  const completedView: ConversationView = {
    ...conversation,
    generation_batches: [completedBatch],
    messages: [
      {
        id: "user-one",
        conversation_id: conversation.id,
        role: "user",
        body: "A test prompt",
        created_at: timestamp,
      },
      ...completedBatch.targets.map((target) => ({
        id: target.generation.assistant_message_id!,
        conversation_id: conversation.id,
        role: "assistant",
        body: `Answer from ${target.model_id}`,
        provider_snapshot: target.generation.snapshot,
        created_at: timestamp,
      })),
    ],
  };
  return {
    conversation,
    secondConversation,
    profile,
    models,
    settings,
    pendingBatch,
    completedBatch,
    completedView,
  };
}

export function createBatchEventFeed(batch: GenerationBatch) {
  let controller!: ReadableStreamDefaultController<GenerationBatchEvent>;
  let closed = false;
  let sequence = 0;
  const stream = new ReadableStream<GenerationBatchEvent>({
    start(value) {
      controller = value;
    },
  });
  return {
    emit(
      targetIndex: number,
      type: GenerationBatchEvent["type"],
      delta?: string,
    ) {
      const target = batch.targets[targetIndex]!;
      controller.enqueue({
        event_id: String(++sequence),
        batch_id: batch.id,
        target_id: target.id,
        generation_id: target.generation.id,
        type,
        delta,
      });
    },
    close() {
      if (!closed) controller.close();
      closed = true;
    },
    async *events(): AsyncGenerator<GenerationBatchEvent> {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
