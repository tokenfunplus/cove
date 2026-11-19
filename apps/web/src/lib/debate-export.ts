import type { DebateView } from "@cove/api-contract";

export function debateMarkdown(view: DebateView): string {
  return [
    `# ${view.session.topic}`,
    `Status: ${view.session.status}`,
    `Completed turns: ${view.session.total_turns}`,
    "",
    "## Current ground rules",
    view.session.rules.text,
    "",
    ...view.turns
      .filter((turn) => turn.state !== "streaming")
      .map(
        (turn) =>
          `## Turn ${turn.sequence} · Round ${turn.round} · ${turn.role}\nProvider: ${turn.snapshot.provider_name} · ${turn.snapshot.model_id}\nDestination: ${turn.snapshot.destination}\nRules: v${turn.rule_version} · State: ${turn.state}\n${turn.verification ? `Verification: ${turn.verification.status}\n` : ""}\n${turn.body || turn.error_message || ""}\n`,
      ),
    "## Recent interventions (up to 64)",
    ...view.interventions.map(
      (note) =>
        `${note.applied_round ? `Round ${note.applied_round}` : "Not applied"}: ${note.body}\n`,
    ),
  ].join("\n");
}
