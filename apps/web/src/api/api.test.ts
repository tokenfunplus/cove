import {
  browserSessionHeaders,
  clearChatData,
  createConversation,
  createGenerationBatch,
  getConversation,
  getConversations,
  getGenerationBatch,
  getProviderCatalog,
  getProviderProfiles,
  getSession,
  getSettings,
  markSecureGenerationEnvironment,
  markSecureGenerationResponseVerification,
  markSecureGenerationStreaming,
  renameConversation,
  retryGenerationTarget,
  settleSecureGeneration,
  subscribeGenerationBatch,
  testProviderConnection,
  updateConversation,
  updateSettings,
} from "@/api";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("web transport distinguishes an unreachable local service from a Provider failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );

  await expect(getProviderProfiles()).rejects.toMatchObject({
    name: "LocalServiceError",
    envelope: { error: { code: "service_unavailable" } },
  });
});

test("web transport reads the local session CSRF contract", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetch);

  await expect(getSession()).resolves.toEqual({ csrf_token: "csrf-token" });
  expect(fetch).toHaveBeenCalledWith("/api/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  expect(browserSessionHeaders()).toEqual({
    "X-Cove-CSRF-Token": "csrf-token",
  });
});

test("web transport reads the locally persisted conversation list", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id: "conversation-1",
          title: "Offline chat",
          created_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        },
      ]),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  await expect(getConversations()).resolves.toHaveLength(1);
  const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(path).toBe("/api/conversations");
  expect(init.credentials).toBe("same-origin");
  expect(new Headers(init.headers).get("Accept")).toBe("application/json");
});

test("web transport deletes a conversation with the local CSRF contract", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(
    (await import("@/api")).deleteConversation("conversation-1"),
  ).resolves.toBeUndefined();
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/conversations/conversation-1");
  expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport filters archived conversations and updates one local conversation property", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);

  await expect(getConversations({ archived: true })).resolves.toEqual([]);
  await getSession();
  await expect(
    updateConversation("conversation-1", { pinned: true }),
  ).resolves.toBeUndefined();

  expect(fetch.mock.calls[0]?.[0]).toBe("/api/conversations?archived=true");
  expect(fetch.mock.calls[2]?.[0]).toBe("/api/conversations/conversation-1");
  expect(fetch.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ pinned: true }));
  expect(
    new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport clears conversation history with the local CSRF contract", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(clearChatData()).resolves.toBeUndefined();
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/data");
  expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport reads and updates persisted workspace settings", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          theme: "system",
          locale: "system",
          system_prompt: "",
          temperature: null,
          top_p: null,
          max_tokens: null,
          active_model_set: [],
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          theme: "dark",
          locale: "zh",
          system_prompt: "Be concise.",
          temperature: 0.4,
          top_p: 0.9,
          max_tokens: 1024,
          active_model_set: [],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(getSettings()).resolves.toMatchObject({ theme: "system" });
  await expect(
    updateSettings({
      theme: "dark",
      locale: "zh",
      system_prompt: "Be concise.",
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: 1024,
      active_model_set: [],
    }),
  ).resolves.toMatchObject({ locale: "zh", max_tokens: 1024 });
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/settings");
  expect(fetch.mock.calls[2]?.[0]).toBe("/api/settings");
  expect(
    new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport reads messages from the conversation detail", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "conversation-1", messages: [] }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(getConversation("conversation-1")).resolves.toMatchObject({
    id: "conversation-1",
    messages: [],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/conversations/conversation-1");
});

test("web transport creates and renames conversations with CSRF and handles no-content responses", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "conversation-1",
          title: "Offline chat",
          created_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        }),
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(createConversation("Offline chat")).resolves.toMatchObject({
    title: "Offline chat",
  });
  await expect(
    renameConversation("conversation-1", "Renamed offline"),
  ).resolves.toBeUndefined();
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/conversations");
  expect(fetch.mock.calls[2]?.[0]).toBe("/api/conversations/conversation-1");
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
  expect(
    new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport configures providers through the secret-free profile contract", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ models: ["model-a"] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: "provider-1",
            kind: "nearai",
            name: "NearAI",
            endpoint: "https://cloud-stg-api.near.ai",
            model_id: "model-a",
            auth_method: "bearer",
            runtime_location: "NearAI cloud",
            destination: "cloud-stg-api.near.ai",
            transport_security: "tls",
            privacy_notice: "notice",
            configured: true,
            created_at: "2026-09-10T00:00:00Z",
            updated_at: "2026-09-10T00:00:00Z",
          },
        ]),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(
    testProviderConnection({
      kind: "nearai",
      name: "NearAI",
      endpoint: "https://cloud-stg-api.near.ai",
      model_id: "model-a",
      auth_method: "bearer",
      secret: "secret-value",
    }),
  ).resolves.toEqual({ models: ["model-a"] });
  await expect(getProviderProfiles()).resolves.toHaveLength(1);
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/models/test");
  expect(fetch.mock.calls[2]?.[0]).toBe("/api/models");
  expect(JSON.stringify(fetch.mock.calls[1]?.[1]?.body)).toContain(
    "secret-value",
  );
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("web transport reads a Provider model catalog through its typed endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ models: ["model-a", "model-b"] }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetch);

  await expect(getProviderCatalog("provider/one")).resolves.toEqual({
    models: ["model-a", "model-b"],
  });
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/models/provider%2Fone/catalog");
});

test("generation Batch transport sends only the workspace-owned request identity and body", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "batch-1", targets: [] }), {
      status: 201,
    }),
  );
  vi.stubGlobal("fetch", fetch);

  await createGenerationBatch("conversation-1", {
    clientRequestId: "request-owned-by-workspace",
    body: "Hello",
  });

  const body = JSON.parse(
    String((fetch.mock.calls[0]?.[1] as RequestInit).body),
  );
  expect(body).toMatchObject({ body: "Hello" });
  expect(body).not.toHaveProperty("provider_id");
  expect(body).not.toHaveProperty("model_id");
  expect(body.client_request_id).toBe("request-owned-by-workspace");
});

test("secure Generation transport advances lifecycle and settles the verification record", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "generation-1",
            state: "verifying_response",
            verification: { status: "verified_model" },
          }),
          { status: 200 },
        ),
      ),
    );
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await markSecureGenerationEnvironment("generation-1");
  await markSecureGenerationStreaming("generation-1");
  await markSecureGenerationResponseVerification("generation-1");
  await settleSecureGeneration("generation-1", "Verified answer", {
    status: "verified_model",
    completion_id: "completion-1",
    signature_kind: "provider_tee",
    signing_address: "signer",
    signing_algorithm: "ed25519",
    signed_message: "signed-message",
    signature: "signature",
    signature_digest: "sha256:receipt",
  });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    "/api/session",
    "/api/generations/generation-1/secure/environment",
    "/api/generations/generation-1/secure/streaming",
    "/api/generations/generation-1/secure/response",
    "/api/generations/generation-1/secure/settle",
  ]);
  expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toMatchObject({
    body: "Verified answer",
    verification: {
      signature_kind: "provider_tee",
      signed_message: "signed-message",
      signature: "signature",
    },
  });
});

test("web transport creates, reads, retries, and cancels a Generation Batch through JSON contracts", async () => {
  const generation = {
    id: "generation-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "pending",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "notice",
    },
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "pending",
    targets: [
      {
        id: "target-1",
        provider_id: "provider-1",
        model_id: "model-a",
        position: 0,
        generation,
      },
    ],
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ csrf_token: "csrf-token" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(batch), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(batch), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...batch, state: "stopped" }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(generation), { status: 201 }),
    );
  vi.stubGlobal("fetch", fetch);

  await getSession();
  await expect(
    createGenerationBatch("conversation-1", {
      clientRequestId: "request-1",
      body: "Hello",
    }),
  ).resolves.toMatchObject({ id: "batch-1" });
  await expect(getGenerationBatch("batch-1")).resolves.toMatchObject({
    state: "pending",
  });
  await expect(
    (await import("@/api")).cancelGenerationBatch("batch-1"),
  ).resolves.toMatchObject({ state: "stopped" });
  await expect(
    retryGenerationTarget("target-1", "request-2"),
  ).resolves.toMatchObject({ id: "generation-1" });
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    "/api/session",
    "/api/conversations/conversation-1/messages",
    "/api/generation-batches/batch-1",
    "/api/generation-batches/batch-1/cancel",
    "/api/generation-targets/target-1/retry",
  ]);
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Cove-CSRF-Token"),
  ).toBe("csrf-token");
});

test("Batch transport decodes target events and resumes from the last event ID", async () => {
  const generation = {
    id: "generation-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "streaming",
    snapshot: {
      provider_id: "provider-1",
      provider_name: "Fixture",
      model_id: "model-a",
      runtime_location: "User configured cloud provider",
      destination: "provider.example",
      transport_security: "tls",
      privacy_notice: "notice",
    },
    events_url: "/api/generations/generation-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  const batch = {
    id: "batch-1",
    conversation_id: "conversation-1",
    client_request_id: "request-1",
    state: "streaming",
    targets: [
      {
        id: "target-1",
        provider_id: "provider-1",
        model_id: "model-a",
        position: 0,
        generation,
      },
    ],
    events_url: "/api/generation-batches/batch-1/events",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        'id: 4\nevent: delta\ndata: {"event_id":"4","batch_id":"batch-1","target_id":"target-1","generation_id":"generation-1","type":"delta","delta":"Hello"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(batch), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(
        'id: 5\nevent: completed\ndata: {"event_id":"5","batch_id":"batch-1","target_id":"target-1","generation_id":"generation-1","type":"completed"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...batch, state: "completed" }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetch);

  const events = [];
  for await (const event of subscribeGenerationBatch("batch-1", "3")) {
    events.push(event);
  }
  expect(events).toEqual([
    {
      event_id: "4",
      batch_id: "batch-1",
      target_id: "target-1",
      generation_id: "generation-1",
      type: "delta",
      delta: "Hello",
    },
    {
      event_id: "5",
      batch_id: "batch-1",
      target_id: "target-1",
      generation_id: "generation-1",
      type: "completed",
    },
  ]);
  const firstInit = fetch.mock.calls[0]?.[1] as RequestInit;
  const secondInit = fetch.mock.calls[2]?.[1] as RequestInit;
  expect(new Headers(firstInit.headers).get("Last-Event-ID")).toBe("3");
  expect(new Headers(secondInit.headers).get("Last-Event-ID")).toBe("4");
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    "/api/generation-batches/batch-1/events",
    "/api/generation-batches/batch-1",
    "/api/generation-batches/batch-1/events",
    "/api/generation-batches/batch-1",
  ]);
});
