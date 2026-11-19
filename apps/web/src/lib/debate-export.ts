import type { DebateStageSummary, DebateView } from "@cove/api-contract";

export function stageSummaryMarkdown(summary: DebateStageSummary): string {
  return [
    `### Stage summary · Rounds ${summary.from_round}–${summary.through_round}`,
    "AI-generated interpretation of the linked public statements.",
    ...([['New ideas', summary.new_ideas], ['Position changes', summary.position_changes], ['Open questions', summary.open_questions]] as const).flatMap(([title, points]) => [
      `\n#### ${title}`,
      ...points.map(point => `- ${point.text} (Sources: ${point.sources.map(source => `Turn ${source.sequence}, seat ${source.seat + 1}`).join("; ")})`),
      ...(points.length ? [] : ["No supported points identified."]),
    ]),
  ].join("\n");
}

export function debateMarkdown(view: DebateView): string {
  return [
    `# ${view.session.topic}`,
    `Status: ${view.session.status}`,
    `Completed turns: ${view.session.total_turns}`,
    ...(view.usage ? [`Reported input tokens: ${view.usage.input_tokens}`, `Reported output tokens: ${view.usage.output_tokens}`, `Missing usage: ${view.usage.missing_usage_calls} calls`, `Estimated cost (USD): ${view.usage.estimated_cost_usd.toFixed(6)}${view.usage.cost_complete ? "" : " (partial; usage or rates unavailable)"}`, `Summary calls: ${view.usage.summary_calls}`] : []),
    "",
    "## Current ground rules",
    view.session.rules.text,
    "",
    ...view.turns
      .filter((turn) => turn.state !== "streaming")
      .map(
        (turn) =>
          `## Turn ${turn.sequence} · Round ${turn.round} · ${turn.kind === "summary" ? "Stage summary" : turn.role}\nProvider: ${turn.snapshot.provider_name} · ${turn.snapshot.model_id}\nDestination: ${turn.snapshot.destination}\nRules: v${turn.rule_version} · State: ${turn.state}\n${turn.verification ? `Verification: ${turn.verification.status}\n` : ""}\n${turn.summary ? stageSummaryMarkdown(turn.summary) : turn.body || turn.error_message || ""}\n`,
      ),
    "## Recent interventions (up to 64)",
    ...view.interventions.map(
      (note) =>
        `${note.applied_round ? `Round ${note.applied_round}` : "Not applied"}: ${note.body}\n`,
    ),
  ].join("\n");
}
