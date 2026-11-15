import {
  buildConversationExport,
  buildWorkspaceExport,
  loadWorkspaceExportViews,
} from "@/lib/conversation-export";
import type { ConversationView } from "@cove/api-contract";
import { expect, test, vi } from "vitest";

const view: ConversationView = {
  id: "conversation-1",
  title: "Project / notes",
  created_at: "2026-09-17T01:00:00Z",
  updated_at: "2026-09-17T02:00:00Z",
  messages: [
    {
      id: "message-1",
      conversation_id: "conversation-1",
      role: "user",
      body: "Keep this local.",
      created_at: "2026-09-17T01:00:00Z",
    },
    {
      id: "message-2",
      conversation_id: "conversation-1",
      role: "assistant",
      body: "It stays in your Conversation History.",
      created_at: "2026-09-17T02:00:00Z",
      provider_snapshot: {
        provider_id: "provider-1",
        provider_name: "Fixture Provider",
        model_id: "model-a",
        runtime_location: "Cloud",
        destination: "provider.example",
        transport_security: "tls",
        privacy_notice: "Sent over TLS.",
      },
    },
  ],
};

test("builds a portable local Markdown export with message and snapshot context", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
  const exported = buildConversationExport(view, "markdown");

  expect(exported.filename).toBe("Project - notes.md");
  expect(exported.mimeType).toBe("text/markdown;charset=utf-8");
  expect(exported.content).toContain("# Project / notes");
  expect(exported.content).toContain("## You");
  expect(exported.content).toContain("## Assistant");
  expect(exported.content).toContain("> Provider: Fixture Provider (model-a)");
  vi.useRealTimers();
});

test("builds a workspace JSON export from local conversation views", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
  const exported = buildWorkspaceExport([view], "json");
  expect(exported.filename).toBe("conversations.json");
  expect(JSON.parse(exported.content)).toMatchObject({
    exported_at: "2026-09-17T03:00:00.000Z",
    conversations: [view],
  });
  vi.useRealTimers();
});

test("workspace export loads active and archived conversations without duplicates", async () => {
  const archived = { ...view, id: "conversation-2", title: "Archived" };
  const listConversations = vi.fn(async (showArchived: boolean) =>
    showArchived
      ? [
          {
            id: archived.id,
            title: archived.title,
            created_at: archived.created_at,
            updated_at: archived.updated_at,
          },
        ]
      : [
          {
            id: view.id,
            title: view.title,
            created_at: view.created_at,
            updated_at: view.updated_at,
          },
          {
            id: archived.id,
            title: archived.title,
            created_at: archived.created_at,
            updated_at: archived.updated_at,
          },
        ],
  );
  const loadConversation = vi.fn(async (id: string) =>
    id === view.id ? view : archived,
  );

  const views = await loadWorkspaceExportViews(
    listConversations,
    loadConversation,
  );

  expect(views.map((conversation) => conversation.id)).toEqual([
    view.id,
    archived.id,
  ]);
  expect(listConversations).toHaveBeenCalledTimes(2);
  expect(loadConversation).toHaveBeenCalledTimes(2);
});

test("builds a JSON export from the authoritative ConversationView", () => {
  const exported = buildConversationExport(view, "json");

  expect(exported.filename).toBe("Project - notes.json");
  expect(exported.mimeType).toBe("application/json;charset=utf-8");
  expect(JSON.parse(exported.content)).toEqual(view);
});

test("exports saved source text and versions without original binary data", () => {
  const source = {
    id: "a".repeat(64),
    name: "notes.md",
    media_type: "text/plain" as const,
    size: 6,
    characters: 6,
    extraction_version: "cove-text-v1",
    sections: [{ id: "L1", text: "Source" }],
  };
  const batch = {
    id: "files",
    conversation_id: view.id,
    client_request_id: "files",
    state: "completed" as const,
    targets: [],
    events_url: "/unused",
    created_at: view.created_at,
    updated_at: view.updated_at,
    attachments: [source],
    input_content: "A question with Source",
  };
  const data = { ...view, generation_batches: [batch] };
  expect(buildConversationExport(data, "markdown").content).toContain(
    "    Source",
  );
  const exported = JSON.parse(buildConversationExport(data, "json").content);
  expect(exported.generation_batches[0].attachments[0]).toEqual(source);
  expect(exported.generation_batches[0].attachment_data).toBeUndefined();
});
