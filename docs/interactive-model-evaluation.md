# Interactive model evaluation

Measured on 2026-11-25 using Ollama Llama 3.2 1B and 3B, default registry quantization. This is a reproducible 20-case synthetic sample, not a model certification. Each case was also run without the UI guide as a token baseline. Cloud models were not tested.

Initial baseline settings: temperature 0, seed 42, 8,192 context tokens, 768 maximum output tokens. Provider-reported token counts are used. The original guide was 1,945 characters including its header (about 413 additional prompt tokens in this sample). The following baseline used the parser before bounded delimiter repair; malformed JSON was not syntactically repaired.

| Model | Valid / attempted cards (all prompts) | Suitable prompts yielding a valid card | Plain prompts attempting UI | Mean added prompt tokens | Mean output token delta |
| --- | --- | --- | --- | --- | --- |
| Llama 3.2 1B | 1 / 6 | 0 / 10 | 2 / 10 | 413.0 | +51.2 |
| Llama 3.2 3B | 0 / 7 | 0 / 10 | 1 / 10 | 413.0 | -49.1 |

Both small models produced malformed, truncated, misplaced, or unnecessary UI in this sample. This change therefore makes no claim that every model above 1B reliably generates cards. Normal chat remains available when normalization fails; invalid or incomplete payloads do not activate controls. These fallback properties are tested independently with deterministic browser fixtures.

After the review fixes in [ADR 0067](adr/0067-preserve-chat-prose-and-bound-model-json-repair.md), offline reprocessing of the same saved 3B responses accepts 6 of 7 attempted cards, including 6 of 10 suitable prompts (previously 0 of 10). Four contain choices and two contain only text. Ranking was generated as a Choice rather than a reorderable Ranking, and recall contained a word without a reveal. This is parser recovery, not improved generation quality or proof that the requested interaction was fulfilled. The original 1B arithmetic response still illustrates a copied-example false positive; the new guide uses explicit placeholders and rejects literal example copies retaining its reserved title.

A new 20-case 3B run used the revised 2,130-character fenced-example guide and the same model settings. Evaluating those raw responses with the final framing and repair rules yields 4 valid cards out of 5 attempts, 4 of 10 suitable prompts producing a card, and 1 of 10 plain prompts attempting UI. Mean added prompt tokens were 452.0; output token delta was -14.25. The valid cases were ranking, budget, recall and preference. Ranking still used Choice, and several suitable requests received prose only. These results show remaining interaction-quality and selection problems, not universal compatibility. This fresh generation run is separate from offline recovery of the earlier responses. The updated evaluator counts recognized framing attempts, including malformed ones, rather than mere mentions of UI keywords.

The 20 prompt texts and evaluator are in [interactive-eval](../services/local-service/cmd/interactive-eval/main.go). Reproduce with:

```sh
cd services/local-service
../../scripts/go build -o ../../.artifacts/interactive-eval ./cmd/interactive-eval
COVE_EVAL_MODEL=llama3.2:1b COVE_EVAL_OUTPUT=../../.artifacts/model-eval-1b ../../.artifacts/interactive-eval
COVE_EVAL_MODEL=llama3.2:3b COVE_EVAL_OUTPUT=../../.artifacts/model-eval-3b ../../.artifacts/interactive-eval
```

The command supports an explicitly configured OpenAI-compatible endpoint via COVE_EVAL_ENDPOINT and a key via COVE_EVAL_API_KEY. Keys are not written into result files. Generated raw responses and detailed per-case results remain in ignored artifacts. Model sizes and tags follow the [official Ollama library](https://ollama.com/library/llama3.2).

Credentialed endpoints require HTTPS, and evaluation requests never follow redirects. Unauthenticated loopback HTTP remains available for Ollama. With no explicit output path, every run creates and prints a unique private temporary directory. An explicit COVE_EVAL_OUTPUT retains its user-selected path behavior. The stdin normalize mode allows 32 KiB; extract mode allows a complete answer up to 1 MiB and rejects oversize input rather than truncating it.

The release acceptance boundary is safe degradation and ordinary chat continuity, not minimum parameter-count compatibility.
