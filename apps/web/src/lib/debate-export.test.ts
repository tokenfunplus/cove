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

test("debate exports render stage summaries with original sources and partial usage", () => {
  const fixture = createWorkspaceFixture(2);
  const timestamp = fixture.conversation.created_at;
  const summary = {
    turn_id: "summary-one", from_round: 1, through_round: 3, seat: 1, created_at: timestamp,
    new_ideas: [{ text: "A measurable boundary was proposed.", sources: [{ turn_id: "turn-two", sequence: 2, seat: 1 }] }],
    position_changes: [],
    open_questions: [{ text: "Which measurement would settle this?", sources: [{ turn_id: "turn-one", sequence: 1, seat: 0 }] }],
  };
  const view: DebateView = {
    session: { id: "debate-one", client_request_id: "request", topic: "A synthetic question", seats: [], rules: { version: 1, text: "Challenge claims.", max_tokens: 512, checkpoint_every: 2, rotate: true }, status: "paused", round: 3, position: 2, opening_done: [], total_turns: 6, created_at: timestamp, updated_at: timestamp },
    turns: [{ id: summary.turn_id, debate_id: "debate-one", sequence: 7, round: 3, seat: 1, role: "Challenger", kind: "summary", summary, rule_version: 1, state: "completed", body: JSON.stringify(summary), reasoning: "Private reasoning", snapshot: fixture.pendingBatch.targets[0]!.generation.snapshot, configuration: fixture.pendingBatch.targets[0]!.generation.configuration_snapshot, context_ids: ["turn-one", "turn-two"], created_at: timestamp, updated_at: timestamp }],
    usage: { calls: 7, summary_calls: 1, active_calls: 0, input_tokens: 1000, output_tokens: 500, missing_usage_calls: 1, unpriced_calls: 0, estimated_cost_usd: 0.003, cost_complete: false },
    interventions: [], has_more: false,
  };
  const markdown = debateMarkdown(view);
  expect(markdown).toContain("Stage summary · Rounds 1–3");
  expect(markdown).toContain("A measurable boundary was proposed. (Sources: Turn 2, seat 2)");
  expect(markdown).toContain("Which measurement would settle this? (Sources: Turn 1, seat 1)");
  expect(markdown).toContain("Missing usage: 1 calls");
  expect(markdown).toContain("0.003000 (partial; usage or rates unavailable)");
  expect(markdown).not.toContain('"new_ideas"');
  expect(markdown).not.toContain("Private reasoning");
});
