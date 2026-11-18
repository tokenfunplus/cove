import { ConversationPanel } from "@/components/chat/ConversationPanel";
import { fixtureGenerationConfiguration } from "@/test/generation-fixture";
import type { ConversationView, Generation } from "@cove/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test("conversation workspace renders opened messages without conversation title controls", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        role: "user",
        body: "Saved locally",
        created_at: "2026-09-10T00:00:00Z",
      },
    ],
  };

  const markup = renderToStaticMarkup(<ConversationPanel view={view} />);

  expect(markup).toContain("Saved locally");
  expect(markup).not.toContain("Local conversation");
  expect(markup).not.toContain("Rename conversation");
  expect(markup).not.toContain("Save title");
});

test("conversation composer communicates the NearAI-inspired private mode", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Private notes",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [],
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      onSend={() => {}}
      onDraftChange={() => {}}
    />,
  );

  expect(markup).toContain("Private mode");
});

test("conversation workspace gives an empty state a direct create action", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel view={undefined} onCreateConversation={() => {}} />,
  );

  expect(markup).toContain("Start a new conversation");
  expect(markup).toContain('data-workspace-empty="true"');
});

test("new conversation opens with a private assistant welcome and suggested prompts", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "New conversation",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [],
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      onSend={() => {}}
      onDraftChange={() => {}}
    />,
  );

  expect(markup).toContain("Your conversation");
  expect(markup).toContain(
    "Prompts and selected conversation context go to your Provider",
  );
  expect(markup).toContain("Suggested");
  expect(markup).toContain("Write the letter");
});

test("new conversation keeps the NearAI empty state free of conversation title controls", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "New conversation",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [],
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      onSend={() => {}}
      onDraftChange={() => {}}
    />,
  );

  expect(markup).toContain('data-workspace-empty="true"');
  expect(markup).toContain("Your conversation");
  expect(markup).not.toContain("Rename conversation");
  expect(markup).not.toContain("Save title");
});

test("an archived conversation is readable but cannot start another Generation", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Archived notes",
        archived: true,
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [
          {
            id: "message-1",
            conversation_id: "conversation-1",
            role: "user",
            body: "Keep this",
            created_at: "2026-09-10T00:00:00Z",
          },
        ],
      }}
      onSend={() => {}}
      onDraftChange={() => {}}
    />,
  );

  expect(markup).toContain(
    "This conversation is archived. Unarchive it to continue chatting.",
  );
  expect(markup).not.toContain("generation-composer");
});

test("conversation panel uses the NearAI message layout and metadata chrome", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Number sequence",
        created_at: "2026-09-10T21:10:00Z",
        updated_at: "2026-09-10T21:10:00Z",
        messages: [
          {
            id: "message-1",
            conversation_id: "conversation-1",
            role: "user",
            body: "123123",
            created_at: "2026-09-10T21:10:00Z",
          },
          {
            id: "message-2",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "I see you sent 123123.",
            provider_snapshot: {
              provider_id: "provider-1",
              provider_name: "Free model",
              model_id: "free-model",
              runtime_location: "Configured provider",
              destination: "provider.example",
              transport_security: "tls",
              privacy_notice: "Sent over HTTPS/TLS.",
            },
            created_at: "2026-09-10T21:10:00Z",
          },
        ],
      }}
    />,
  );

  expect(markup).toContain('data-workspace-chat-style="nearai"');
  expect(markup).toContain('data-message-meta="user"');
  expect(markup).toContain('data-message-meta="assistant"');
  expect(markup).toMatch(/class="[^"\n]*\bmessage__timestamp\b[^"\n]*"/);
  expect(markup).toContain("Free model");
  expect(markup).toContain("Response details");
  expect(markup).toContain('data-response-details="true"');
});

test("conversation panel exposes a compact NearAI composer surface", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "New conversation",
        created_at: "2026-09-10T21:10:00Z",
        updated_at: "2026-09-10T21:10:00Z",
        messages: [],
      }}
      onSend={() => {}}
      onDraftChange={() => {}}
      providerStatus="ready"
    />,
  );

  expect(markup).toContain('data-workspace-chat-style="nearai"');
  expect(markup).toContain('data-composer-style="nearai"');
  expect(markup).toContain('aria-label="Conversation messages"');
  expect(markup).toContain('aria-label="Send message"');
});

test("conversation workspace offers generation controls and shows the assistant provider snapshot", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        role: "assistant",
        body: "Hello from the Provider",
        provider_snapshot: {
          provider_id: "provider-1",
          provider_name: "Fixture Provider",
          model_id: "model-a",
          runtime_location: "User configured cloud provider",
          destination: "provider.example",
          transport_security: "tls",
          privacy_notice: "Sent over HTTPS/TLS.",
        },
        created_at: "2026-09-10T00:00:00Z",
      },
    ],
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-2",
    state: "streaming",
    snapshot: view.messages[0].provider_snapshot!,
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      onSend={() => {}}
      onCancel={() => {}}
      onRetry={() => {}}
      generation={generation}
      draft="Partial reply"
      onDraftChange={() => {}}
      isSending={true}
    />,
  );

  expect(markup).toContain("Send message");
  expect(markup).toContain("Stop generation");
  expect(markup).toContain("Fixture Provider");
  expect(markup).toContain("Fixture Provider");
  expect(markup).toContain("model-a");
  expect(markup).toContain("Response details");
  expect(markup).toContain("Partial reply");
  expect(markup).toMatch(/class="[^"\n]*\bchat\-status\-live\b[^"\n]*"/);
  expect(markup).toContain("Response details");
});

test("conversation workspace keeps a live assistant reply inside the scrollable message region", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [],
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-1",
    state: "streaming",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture Provider",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "Sent over HTTPS/TLS.",
    },
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      generation={generation}
      liveAssistantBody="Partial reply"
    />,
  );
  const messageRegionStart = markup.indexOf('data-workspace-region="messages"');
  const liveAssistantReplyStart = markup.indexOf("message--live-assistant");

  expect(liveAssistantReplyStart).toBeGreaterThan(messageRegionStart);
  expect(
    markup.slice(messageRegionStart, liveAssistantReplyStart),
  ).not.toContain("</div>");
  expect(markup).not.toContain("Thinking...");
});

test("conversation workspace keeps a repeated Live Turn visible until its user message ID is known", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Chat",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [
          {
            id: "old-user",
            conversation_id: "conversation-1",
            role: "user",
            body: "Repeat",
            created_at: "2026-09-10T00:00:00Z",
          },
        ],
      }}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-2",
        userBody: "Repeat",
        assistantBody: "",
        phase: "pending",
      }}
    />,
  );

  // Timeline trigger labels also contain the prompt; count the rendered bodies.
  expect((markup.match(/>Repeat<\/p>/g) ?? []).length).toBe(2);
});

test("conversation workspace renders a Live Turn before generation creation resolves", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "New conversation",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [],
      }}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Immediate message",
        assistantBody: "",
        phase: "pending",
      }}
      onSend={() => {}}
      onDraftChange={() => {}}
    />,
  );

  expect(markup).toContain("Immediate message");
  expect(markup).toContain("Waiting for first text");
  expect(markup).not.toContain("Chat with your local assistant");
});

test("conversation workspace keeps thinking visible while streaming has no assistant content yet", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Chat",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [],
      }}
      generation={{
        id: "generation-1",
        conversation_id: "conversation-1",
        client_request_id: "request-1",
        state: "streaming",
        snapshot: {
          provider_id: "provider-1",
          provider_name: "Fixture",
          model_id: "model-a",
          runtime_location: "local",
          destination: "local",
          transport_security: "tls",
          privacy_notice: "notice",
        },
        configuration_snapshot: fixtureGenerationConfiguration,
        events_url: "/api/generations/generation-1/events",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
      }}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Hello",
        assistantBody: "",
        phase: "streaming",
      }}
    />,
  );

  expect(markup).toContain("Waiting for first text");
  expect(markup).not.toContain("data-secure-generation-progress");
});

test("conversation workspace shows the real private verification stages for one live Generation", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Private chat",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [],
      }}
      generation={{
        id: "generation-private",
        conversation_id: "conversation-1",
        client_request_id: "request-private",
        user_message_id: "message-private",
        state: "verifying_environment",
        snapshot: {
          provider_id: "nearai",
          provider_name: "NearAI",
          model_id: "private-model",
          runtime_location: "NearAI cloud",
          destination: "cloud-api.near.ai",
          transport_security: "tls",
          privacy_notice: "Private inference.",
        },
        configuration_snapshot: fixtureGenerationConfiguration,
        verification: { status: "pending" },
        events_url: "/api/generations/generation-private/events",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
      }}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-private",
        userBody: "Verify this",
        assistantBody: "",
        phase: "verifying_environment",
      }}
    />,
  );

  expect(markup).toContain(
    'data-generation-phase="verifying_environment"',
  );
  expect(markup).toContain("Checking environment");
  expect(markup).toContain("Checking environment");
  expect(markup).toContain("Checking environment");
  expect(markup).toContain("Checking environment");
  expect(markup).not.toContain("Thinking...");
});

test("conversation workspace gives an unconfigured Provider a setup entry point", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel view={undefined} providerStatus="unconfigured" />,
  );

  expect(markup).toContain("Configure a Provider key before sending.");
  expect(markup).toContain('href="#provider-settings"');
});

test("conversation workspace explains when the Provider model catalog is unavailable", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel view={undefined} providerStatus="catalog-error" />,
  );

  expect(markup).toContain("Models unavailable");
  expect(markup).toContain('data-provider-status="catalog-error"');
  expect(markup).not.toContain("Configure a Provider key before sending.");
});

test("conversation workspace offers retry after a stopped generation", () => {
  const view: ConversationView = {
    id: "conversation-1",
    title: "Offline chat",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    messages: [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        role: "user",
        body: "Try again",
        created_at: "2026-09-10T00:00:00Z",
      },
    ],
  };
  const generation: Generation = {
    id: "generation-1",
    conversation_id: view.id,
    client_request_id: "request-1",
    user_message_id: "message-1",
    state: "stopped",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture Provider",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "Sent over HTTPS/TLS.",
    },
    configuration_snapshot: fixtureGenerationConfiguration,
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };

  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={view}
      onRetry={() => {}}
      generation={generation}
    />,
  );

  expect(markup).toContain("Retry generation");
  expect(markup).toContain("Response details");
});

test("conversation workspace explains when a Provider hits the output token limit", () => {
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Offline chat",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
        messages: [
          {
            id: "message-1",
            conversation_id: "conversation-1",
            role: "user",
            body: "Try again",
            created_at: "2026-09-10T00:00:00Z",
          },
        ],
      }}
      generation={{
        id: "generation-1",
        conversation_id: "conversation-1",
        client_request_id: "request-1",
        user_message_id: "message-1",
        state: "failed",
        error_code: "output_limit",
        error_message:
          "The Provider reached the output token limit before returning an assistant response.",
        snapshot: {
          provider_id: "provider-1",
          provider_name: "Fixture Provider",
          model_id: "model-a",
          runtime_location: "fixture",
          destination: "provider.example",
          transport_security: "tls",
          privacy_notice: "notice",
        },
        configuration_snapshot: fixtureGenerationConfiguration,
        events_url: "/api/generations/generation-1/events",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
      }}
    />,
  );

  expect(markup).toContain("The Provider reached the output token limit");
  expect(markup).toContain("Increase Max Tokens or leave it blank");
});

test("assistant history shows Gateway, model, and response verification lanes", () => {
  const snapshot = {
    provider_id: "nearai",
    provider_name: "NearAI",
    model_id: "private-model",
    runtime_location: "TEE",
    destination: "nearai",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
    privacy_mode: "private_tee" as const,
  };
  const privateBatch = {
    id: "batch-private",
    conversation_id: "conversation-1",
    client_request_id: "request-private",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-private/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-private",
        provider_id: "nearai",
        model_id: "private-model",
        position: 0,
        generation: {
          id: "generation-private",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-private",
          verification: {
            status: "verified_model" as const,
            signature_kind: "provider_tee" as const,
            lanes: {
              gateway: "verified" as const,
              model: "verified" as const,
              response: "verified" as const,
            },
          },
        },
      },
    ],
  };
  const privateMarkup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Private",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-private",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "TEE answer",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[privateBatch]}
    />,
  );
  expect(privateMarkup).toContain('data-verification-summary="verified"');
  expect(privateMarkup).toContain('data-verification-kind="model"');
  expect(privateMarkup).toContain("Gateway, model &amp; response verified");
  expect(privateMarkup).toContain("Response details");

  const incognitoSnapshot = {
    ...snapshot,
    model_id: "openai/gpt-4.1-mini",
    privacy_mode: "incognito" as const,
  };
  const incognitoBatch = {
    id: "batch-incognito",
    conversation_id: "conversation-1",
    client_request_id: "request-incognito",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-incognito/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-incognito",
        provider_id: "nearai",
        model_id: "openai/gpt-4.1-mini",
        position: 0,
        generation: {
          id: "generation-incognito",
          state: "completed" as const,
          snapshot: incognitoSnapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-incognito",
          verification: {
            status: "verified_gateway" as const,
            signature_kind: "gateway" as const,
            lanes: {
              gateway: "verified" as const,
              response: "verified" as const,
            },
          },
        },
      },
    ],
  };
  const incognitoMarkup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Incognito",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-incognito",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Gateway answer",
            provider_snapshot: incognitoSnapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[incognitoBatch]}
      privateMode={false}
    />,
  );
  expect(incognitoMarkup).not.toContain('data-verification-lane="model"');
  expect(incognitoMarkup).toContain('data-verification-summary="verified"');
  expect(incognitoMarkup).toContain('data-verification-kind="gateway"');
  expect(incognitoMarkup).toContain("Gateway &amp; response verified");
  expect(incognitoMarkup).not.toContain("Private mode");

  const chutesSnapshot = {
    ...snapshot,
    model_id: "moonshotai/kimi-k3",
    privacy_mode: "chutes" as const,
  };
  const chutesBatch = {
    id: "batch-chutes",
    conversation_id: "conversation-1",
    client_request_id: "request-chutes",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-chutes/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-chutes",
        provider_id: "nearai",
        model_id: "moonshotai/kimi-k3",
        position: 0,
        generation: {
          id: "generation-chutes",
          state: "completed" as const,
          snapshot: chutesSnapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-chutes",
          verification: {
            status: "failed" as const,
            failure_code: "response_verification_failed",
            lanes: {
              gateway: "verified" as const,
              response: "failed" as const,
            },
          },
        },
      },
    ],
  };
  const chutesMarkup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Chutes",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-chutes",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Unverified Chutes answer",
            provider_snapshot: chutesSnapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[chutesBatch]}
      privateMode={false}
    />,
  );
  expect(chutesMarkup).toContain("Unverified Chutes answer");
  expect(chutesMarkup).not.toContain('data-verification-lane="model"');
  expect(chutesMarkup).toContain('data-verification-summary="failed"');
  expect(chutesMarkup).toContain('data-verification-kind="gateway"');
  expect(chutesMarkup).toContain("Verification needs attention");
});

test("historical verification lanes follow the saved snapshot", () => {
  const snapshot = {
    provider_id: "nearai",
    provider_name: "NearAI",
    model_id: "openai/gpt-4.1-mini",
    runtime_location: "TEE",
    destination: "nearai",
    transport_security: "tls" as const,
    privacy_notice: "fixture",
    privacy_mode: "incognito" as const,
  };
  const batch = {
    id: "batch-history",
    conversation_id: "conversation-1",
    client_request_id: "request-history",
    state: "completed" as const,
    events_url: "/api/generation-batches/batch-history/events",
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    targets: [
      {
        id: "target-history",
        provider_id: "nearai",
        model_id: "openai/gpt-4.1-mini",
        position: 0,
        generation: {
          id: "generation-history",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-history",
          verification: {
            status: "verified_gateway" as const,
            signature_kind: "gateway" as const,
            lanes: {
              gateway: "verified" as const,
              response: "verified" as const,
            },
          },
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "History",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-history",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Saved gateway answer",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[batch]}
    />,
  );
  expect(markup).not.toContain('data-verification-lane="model"');
  expect(markup).toContain('data-verification-summary="verified"');
  expect(markup).toContain('data-verification-kind="gateway"');
  expect(markup).toContain("Gateway &amp; response verified");
});

test("verified private history exposes model evidence details and a safe re-verification action", () => {
  const snapshot = {
    provider_id: "nearai",
    provider_name: "NearAI",
    model_id: "private-model",
    runtime_location: "TEE",
    destination: "nearai",
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
        provider_id: "nearai",
        model_id: "private-model",
        position: 0,
        generation: {
          id: "generation-a",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-a",
          verification: {
            status: "verified_model" as const,
            evidence: {
              kind: "model" as const,
              signer_address: "signer",
              signing_algorithm: "ed25519",
              tcb_status: "UpToDate",
              gpu_evidence: "not_provided" as const,
              raw: { quote: "fixture" },
            },
          },
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Private",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-a",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Verified answer",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[batch]}
      onVerifyAgain={() => {}}
    />,
  );
  expect(markup).toContain("Response details");
  expect(markup).toContain('aria-haspopup="dialog"');
});

test("a completed private answer is not rendered twice while the live target lacks its message id", () => {
  const snapshot = {
    provider_id: "nearai",
    provider_name: "NearAI",
    model_id: "private-model",
    runtime_location: "TEE",
    destination: "nearai",
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
        provider_id: "nearai",
        model_id: "private-model",
        position: 0,
        generation: {
          id: "generation-a",
          state: "completed" as const,
          snapshot,
          configuration_snapshot: fixtureGenerationConfiguration,
          assistant_message_id: "assistant-a",
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ConversationPanel
      view={{
        id: "conversation-1",
        title: "Private",
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
        messages: [
          {
            id: "assistant-a",
            conversation_id: "conversation-1",
            role: "assistant",
            body: "Same answer",
            provider_snapshot: snapshot,
            created_at: "2026-09-17T00:00:01Z",
          },
        ],
      }}
      generationBatches={[batch]}
      liveTurn={{
        conversationId: "conversation-1",
        clientRequestId: "request-1",
        userBody: "Question",
        batchId: "batch-1",
        targets: [
          {
            key: "target-a",
            targetId: "target-a",
            generationId: "generation-a",
            providerId: "nearai",
            modelId: "private-model",
            snapshot,
            assistantBody: "Same answer",
            phase: "completed",
          },
        ],
      }}
    />,
  );

  expect(markup.match(/Same answer/g)).toHaveLength(1);
});
