import {
  buildConversationExport,
  buildWorkspaceExport,
  loadWorkspaceExportViews,
} from "@/lib/conversation-export";
import type { ConversationView } from "@cove/api-contract";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
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

test.each(["selected", "skipped", "unresolved"] as const)("Markdown preserves %s comparison disposition without mutating history", (state) => {
  const fixture = createWorkspaceFixture(2);
  const batch = structuredClone(fixture.completedBatch);
  batch.user_message_id = fixture.completedView.messages.find((message) => message.role === "user")!.id;
  batch.selected_generation_id = state === "selected" ? batch.targets[1]!.generation.id : undefined;
  batch.context_skipped = state === "skipped";
  const conversation = { ...fixture.completedView, generation_batches: [batch] };
  const original = JSON.stringify(conversation);
  const markdown = buildConversationExport(conversation, "markdown").content;
  expect(markdown).toContain("## Turn 1");
  expect(markdown).toContain("immutable Context Snapshots");
  if (state === "selected") {
    expect(markdown).toContain(`Selected Answer at export: ${batch.targets[1]!.generation.snapshot.provider_name} (${batch.targets[1]!.model_id})`);
    expect(markdown).toContain(`Generation ${batch.targets[1]!.generation.id}`);
  } else if (state === "skipped") expect(markdown).toContain("Skipped for later context");
  else expect(markdown).toContain("Unresolved comparison: no Selected Answer; not skipped");
  for (const message of conversation.messages) expect(markdown).toContain(message.body);
  expect(JSON.stringify(conversation)).toBe(original);
});

test("late comparison answers stay grouped with their originating prompt", () => {
  const fixture = createWorkspaceFixture(2);
  const batch = { ...fixture.completedBatch, selected_generation_id: fixture.completedBatch.targets[1]!.generation.id };
  const followup = { ...fixture.completedView.messages[0]!, id: "followup", body: "A later user turn" };
  const conversation = {
    ...fixture.completedView,
    generation_batches: [batch],
    messages: [fixture.completedView.messages[0]!, followup, ...fixture.completedView.messages.slice(1)],
  };
  const markdown = buildConversationExport(conversation, "markdown").content;
  const selectedBody = fixture.completedView.messages[2]!.body;
  expect(markdown.indexOf(selectedBody)).toBeLessThan(markdown.indexOf(followup.body));
  expect(markdown.split(selectedBody)).toHaveLength(2);
});

test("exports the original Selected Answer even when its Target has a newer retry", () => {
  const fixture = createWorkspaceFixture(2);
  const batch = structuredClone(fixture.completedBatch);
  const original = batch.targets[0]!.generation;
  batch.selected_generation_id = original.id;
  batch.selected_answer = {
    generation_id: original.id, assistant_message_id: original.assistant_message_id!,
    provider_name: "Original Provider", model_id: "model-one",
  };
  batch.targets[0]!.generation = { ...original, id: "newer-retry", state: "pending", assistant_message_id: undefined };
  const conversation = { ...fixture.completedView, generation_batches: [batch] };
  const markdown = buildConversationExport(conversation, "markdown").content;
  expect(markdown).toContain("Selected Answer at export: Original Provider (model-one)");
  expect(markdown).toContain(`Generation ${original.id}`);
  expect(markdown).toContain(fixture.completedView.messages[1]!.body);
});

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
