import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { fixtureGenerationConfiguration } from "@/test/generation-fixture";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("a Model Comparison renders one independent answer card per Generation Target", () => {
  const snapshot = {
    provider_id: "provider-a",
    provider_name: "Provider A",
    model_id: "model-a",
    runtime_location: "fixture",
    destination: "provider-a.example",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-a",
        provider_id: "provider-a",
        model_id: "model-a",
        position: 0,
        generation: {
          id: "generation-a",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
        },
      },
      {
        id: "target-b",
        provider_id: "provider-b",
        model_id: "model-b",
        position: 1,
        generation: {
          id: "generation-b",
          state: "completed" as const,
          snapshot: {
            ...snapshot,
            provider_id: "provider-b",
            provider_name: "Provider B",
            model_id: "model-b",
          },
          configuration_snapshot: fixtureGenerationConfiguration,
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Compare",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [],
      }}
      generationBatch={batch}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Compare",
        batchId: "batch-1",
        targets: [
          {
            key: "target-a",
            targetId: "target-a",
            generationId: "generation-a",
            providerId: "provider-a",
            modelId: "model-a",
            snapshot,
            assistantBody: "Answer A",
            phase: "completed",
          },
          {
            key: "target-b",
            targetId: "target-b",
            generationId: "generation-b",
            providerId: "provider-b",
            modelId: "model-b",
            snapshot: {
              ...snapshot,
              provider_id: "provider-b",
              provider_name: "Provider B",
              model_id: "model-b",
            },
            assistantBody: "Answer B",
            phase: "completed",
          },
        ],
      }}
      onSelectAnswer={() => {}}
      onSkipContext={() => {}}
    />,
  );

  expect(markup).toContain('data-generation-target="target-a"');
  expect(markup).toContain('data-app-selection-source="conversation-1"');
  expect(markup).toContain('data-generation-target="target-b"');
  expect(markup).toContain("model-comparison-grid");
  expect(markup).toMatch(
    /class="[^"\n]*\bmodel\-answer\-card[^"\n]*\bmodel\-answer\-card\-\-completed\b[^"\n]*"/,
  );
  expect(markup).toContain("Answer A");
  expect(markup).toContain("Answer B");
  expect(markup).toContain("Use for next turn");
  expect(markup).toContain("Continue without an answer");
  expect(markup).toContain("conversation-panel__skip-context");
  expect(markup).toContain("note-band");
});

test("completed comparison answers move from the Live Turn into history without duplication and remain selectable", () => {
  const snapshot = {
    provider_id: "provider-a",
    provider_name: "Provider A",
    model_id: "model-a",
    runtime_location: "fixture",
    destination: "provider-a.example",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-a",
        provider_id: "provider-a",
        model_id: "model-a",
        position: 0,
        generation: {
          id: "generation-a",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-a",
        },
      },
      {
        id: "target-b",
        provider_id: "provider-b",
        model_id: "model-b",
        position: 1,
        generation: {
          id: "generation-b",
          state: "completed" as const,
          snapshot: {
            ...snapshot,
            provider_id: "provider-b",
            provider_name: "Provider B",
            model_id: "model-b",
          },
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-b",
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Compare",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "user-a",
            conversation_id: "conversation-1",
            role: "user",
            body: "Compare",
            created_at: "2026-09-17T00:00:00Z",
          },
          {
            id: "assistant-a",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Answer A",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
          {
            id: "assistant-b",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Answer B",
            provider_snapshot: {
              ...snapshot,
              provider_id: "provider-b",
              provider_name: "Provider B",
              model_id: "model-b",
            },
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[batch]}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Compare",
        userMessageId: "user-a",
        batchId: "batch-1",
        targets: [
          {
            key: "target-a",
            targetId: "target-a",
            generationId: "generation-a",
            assistantMessageId: "assistant-a",
            providerId: "provider-a",
            modelId: "model-a",
            snapshot,
            assistantBody: "Answer A",
            phase: "completed",
          },
          {
            key: "target-b",
            targetId: "target-b",
            generationId: "generation-b",
            assistantMessageId: "assistant-b",
            providerId: "provider-b",
            modelId: "model-b",
            snapshot: {
              ...snapshot,
              provider_id: "provider-b",
              provider_name: "Provider B",
              model_id: "model-b",
            },
            assistantBody: "Answer B",
            phase: "completed",
          },
        ],
      }}
      onSelectAnswer={() => {}}
    />,
  );

  expect(markup.match(/Answer A/g)).toHaveLength(1);
  expect(markup).toContain('data-app-selection-source="conversation-1"');
  expect(markup.match(/Answer B/g)).toHaveLength(1);
  expect(markup).toContain("Use for next turn");
});

test("a historical Model Comparison retains the selected answer after its context is frozen", () => {
  const snapshot = {
    provider_id: "provider-a",
    provider_name: "Provider A",
    model_id: "model-a",
    runtime_location: "fixture",
    destination: "provider-a.example",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "completed" as const,
    selected_generation_id: "generation-b",
    context_frozen: true,
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-a",
        provider_id: "provider-a",
        model_id: "model-a",
        position: 0,
        generation: {
          id: "generation-a",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-a",
        },
      },
      {
        id: "target-b",
        provider_id: "provider-b",
        model_id: "model-b",
        position: 1,
        generation: {
          id: "generation-b",
          state: "completed" as const,
          snapshot: {
            ...snapshot,
            provider_id: "provider-b",
            provider_name: "Provider B",
            model_id: "model-b",
          },
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-b",
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Compare",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-a",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Answer A",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
          {
            id: "assistant-b",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Answer B",
            provider_snapshot: {
              ...snapshot,
              provider_id: "provider-b",
              provider_name: "Provider B",
              model_id: "model-b",
            },
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[batch]}
    />,
  );

  expect(markup).toContain('data-generation-target="target-b"');
  expect(markup).toContain("model-answer-card--selected");
  expect(markup).toContain("Selected for context");
});

test("a streaming target card offers an individual stop action", () => {
  const snapshot = {
    provider_id: "provider-a",
    provider_name: "Provider A",
    model_id: "model-a",
    runtime_location: "fixture",
    destination: "provider-a.example",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "streaming" as const,
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-a",
        provider_id: "provider-a",
        model_id: "model-a",
        position: 0,
        generation: {
          id: "generation-a",
          state: "streaming" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Compare",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [],
      }}
      generationBatch={batch}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Compare",
        batchId: "batch-1",
        targets: [
          {
            key: "target-a",
            targetId: "target-a",
            generationId: "generation-a",
            providerId: "provider-a",
            modelId: "model-a",
            snapshot,
            assistantBody: "",
            phase: "streaming",
          },
        ],
      }}
      onCancelTarget={() => {}}
    />,
  );

  expect(markup).toContain("Stop generation");
});
