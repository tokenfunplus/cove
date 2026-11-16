import type { ConversationView } from "@cove/api-contract";
import { expect, test } from "vitest";
import { conversationTimeline } from "./timeline";

const view: ConversationView = {
  id: "chat-1", title: "Fixture", created_at: "", updated_at: "",
  messages: [
    { id: "user-1", role: "user", body: "Compare **these** ideas", conversation_id: "chat-1", created_at: "" },
    { id: "answer-1", role: "assistant", body: "# First answer\n\nSee [details](https://example.test).", conversation_id: "chat-1", created_at: "" },
    { id: "answer-2", role: "assistant", body: "Second answer", conversation_id: "chat-1", created_at: "" },
    { id: "user-2", role: "user", body: "Next question", conversation_id: "chat-1", created_at: "" },
  ],
};

test("one timeline position represents a turn even with multiple comparison answers", () => {
  expect(conversationTimeline(view)).toEqual([
    { id: "user-1", title: "Compare these ideas", excerpt: "First answer See details." },
    { id: "user-2", title: "Next question", excerpt: "" },
  ]);
  expect(conversationTimeline()).toEqual([]);
});

test("live turns reconcile using durable user message ids without duplicate markers", () => {
  const turn = { conversationId: "chat-1", userMessageId: "user-2", clientRequestId: "request-2", userBody: "Next question", assistantBody: "Working answer" };
  expect(conversationTimeline(view, turn)).toHaveLength(2);
  expect(conversationTimeline(view, turn)[1].excerpt).toBe("Working answer");
  expect(conversationTimeline({ ...view, messages: view.messages.slice(0, 3) }, turn)).toHaveLength(2);
  expect(conversationTimeline(view, { ...turn, conversationId: "other" })[1].excerpt).toBe("");
  expect(conversationTimeline(view, { ...turn, userMessageId: undefined })).toHaveLength(2);
});

test("previews remain bounded and preserve Unicode characters", () => {
  const body = "\u{1f680}".repeat(100);
  const entries = conversationTimeline({ ...view, messages: [{ ...view.messages[0], body }] });
  expect(entries[0].title).toBe("\u{1f680}".repeat(72) + "…");
  expect(conversationTimeline({ ...view, messages: [{ ...view.messages[0], body: "-20 degrees" }] })[0].title).toBe("-20 degrees");
});
