import { expect, test } from "vitest";
import { debateMarkdown } from "./debate-export";
import { buildConversationExport } from "./conversation-export";
import { createWorkspaceFixture } from "@/test/workspace-fixture";
import type { DebateView } from "@cove/api-contract";

test("debate exports preserve attribution and pending input without inventing a verdict", () => {
  const fixture = createWorkspaceFixture(2);
  const view: DebateView = { session: { id: "debate-one", client_request_id: "request", topic: "A synthetic question", seats: [], rules: { version: 2, text: "Challenge claims.", max_tokens: 512, checkpoint_every: 2, rotate: true }, status: "stopped", round: 2, position: 1, opening_done: [], total_turns: 1, created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at }, turns: [{ id: "turn-one", debate_id: "debate-one", sequence: 1, round: 1, seat: 0, role: "Challenger", rule_version: 1, state: "completed", body: "An opposing position.", reasoning: "Intermediate reasoning must remain separate.", snapshot: fixture.pendingBatch.targets[0]!.generation.snapshot, configuration: fixture.pendingBatch.targets[0]!.generation.configuration_snapshot, context_ids: [], created_at: fixture.conversation.created_at, updated_at: fixture.conversation.updated_at }], interventions: [{ id: "note-one", client_request_id: "note-request", body: "A pending question", applied_round: 0, created_at: fixture.conversation.created_at }], has_more: false };
  const markdown = debateMarkdown(view);
  expect(markdown).toContain("Rules: v1"); expect(markdown).toContain("Test Provider · model-one"); expect(markdown).toContain("Not applied: A pending question"); expect(markdown).not.toContain("Intermediate reasoning");
  const exported = buildConversationExport({ ...fixture.conversation, debate_id: "debate-one", debate_export: view }, "markdown");
  expect(exported.content).toBe(markdown);
});
