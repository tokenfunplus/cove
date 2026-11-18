# Separate Provider reasoning from answer text

Provider-declared reasoning is a separate stream channel and saved assistant Message field. OpenAI-compatible chat deltas use `reasoning_content` or `reasoning`; NearAI Gateway Responses events use `response.reasoning_text.delta` and `response.reasoning_summary_text.delta`. Only answer/refusal text enters the answer body. Unrelated tool-argument deltas do not become answer text. The combined reasoning and answer byte limit remains 4 MiB.

The Chat Surface opens Reasoning while streaming and remounts it collapsed when streaming ends, including response verification. Saved reasoning starts collapsed and can be expanded manually. Single answers, comparisons, and answer tools share this presentation. Leading `<think>`, `<reasoning>`, and `<analysis>` blocks retain a presentation-only fallback for Providers that embed explicit boundaries in ordinary text.

Schema 18 adds `messages.reasoning`. Chat owns ordinary stream accumulation; browser inference settles its separately accumulated reasoning through the existing Chat command. Structured reasoning is retained in local history and exports but excluded from Selected Answer context sent in later turns. Embedded tagged text retains its original body and context semantics. Older records default to empty structured reasoning; prose without explicit boundaries is never classified or rewritten by language heuristics.

This extends ADR-0014, ADR-0015, and ADR-0027. Raw request/response entities remain byte-for-byte intact for signature verification; parsing changes their presentation projection only. Saved evidence continues to report the existing browser verification result.
