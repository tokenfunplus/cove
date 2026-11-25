# Interactive model evaluation

Measured on 2026-11-25 using Ollama Llama 3.2 1B and 3B, default registry quantization. This is a reproducible 20-case synthetic sample, not a model certification. Each case was also run without the UI guide as a token baseline. Cloud models were not tested.

Settings: temperature 0, seed 42, 8,192 context tokens, 768 maximum output tokens. Provider-reported token counts are used. The guide is 1,945 characters including its header (about 413 additional prompt tokens in this sample). Responses were evaluated with the final bounded parser; malformed JSON was not syntactically repaired.

| Model | Valid / attempted cards (all prompts) | Suitable prompts yielding a valid card | Plain prompts attempting UI | Mean added prompt tokens | Mean output token delta |
| --- | --- | --- | --- | --- | --- |
| Llama 3.2 1B | 1 / 6 | 0 / 10 | 2 / 10 | 413.0 | +51.2 |
| Llama 3.2 3B | 0 / 7 | 0 / 10 | 1 / 10 | 413.0 | -49.1 |

Both small models produced malformed, truncated, misplaced, or unnecessary UI in this sample. This change therefore makes no claim that every model above 1B reliably generates cards. Normal chat remains available when normalization fails; invalid or incomplete payloads do not activate controls. These fallback properties are tested independently with deterministic browser fixtures.

The 20 prompt texts and evaluator are in [interactive-eval](../services/local-service/cmd/interactive-eval/main.go). Reproduce with:

```sh
cd services/local-service
../../scripts/go build -o ../../.artifacts/interactive-eval ./cmd/interactive-eval
COVE_EVAL_MODEL=llama3.2:1b COVE_EVAL_OUTPUT=../../.artifacts/model-eval-1b ../../.artifacts/interactive-eval
COVE_EVAL_MODEL=llama3.2:3b COVE_EVAL_OUTPUT=../../.artifacts/model-eval-3b ../../.artifacts/interactive-eval
```

The command supports an explicitly configured OpenAI-compatible endpoint via COVE_EVAL_ENDPOINT and a key via COVE_EVAL_API_KEY. Keys are not written into result files. Generated raw responses and detailed per-case results remain in ignored artifacts. Model sizes and tags follow the [official Ollama library](https://ollama.com/library/llama3.2).

The release acceptance boundary is safe degradation and ordinary chat continuity, not minimum parameter-count compatibility.
