export const debateCopy = {
  title: "Debate mode",
  focusEyebrow: "Debate in focus",
  focusBrowserHint: "Keep this page open for NearAI encryption and verification.",
  newDebate: "New debate",
  setupTitle: "Make room for a debate",
  setupDescription:
    "Choose a question, two to four models, and ground rules. The discussion continues until you pause or stop it.",
  topic: "The question",
  rules: "Ground rules",
  defaultRules:
    "Challenge a specific claim, not the speaker.\nSeparate evidence from assumptions and do not invent sources.\nAcknowledge what would change your position.\nAdd a new argument, counterexample, or useful test each turn.",
  roles: [
    "Advocate",
    "Challenger",
    "Evidence analyst",
    "Synthesizer",
    "First principles",
    "Risk analyst",
  ] as const,
  liveBrief: "Live brief",
  checkpoints:
    "Checkpoints preserve attributed positions. Agreement does not end the debate or establish factual correctness.",
  transport:
    "NearAI models use the same browser verification as Chat. Keep this debate open while they participate.",
  browserBackground:
    "Keep this debate open for NearAI encryption and verification. Leaving the page pauses the debate; an unavailable browser times out. Calls use your configured Provider Keys.",
  background:
    "Continues while the Local Service is running, including when this page is closed. Model calls use your configured Provider Keys.",
  pause:
    "Pause finishes active work. Stop cancels it immediately. A restart pauses the session.",
  intervention: "Introduce a perspective or challenge an assumption…",
  pending: "Queued for the next round",
  context:
    "Context uses a checkpoint and recent completed answers. All turns remain saved locally.",
};
