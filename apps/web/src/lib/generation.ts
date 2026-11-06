import { type Generation, type GenerationBatch } from "@cove/api-contract";

export function isTerminalGenerationState(state: Generation["state"]): boolean {
  return state === "completed" || state === "stopped" || state === "failed";
}

export function replaceBatchGeneration(
  batch: GenerationBatch,
  targetID: string,
  generation: Generation,
): GenerationBatch {
  return {
    ...batch,
    targets: batch.targets.map((target) =>
      target.id === targetID
        ? {
            ...target,
            generation: {
              ...target.generation,
              ...generation,
              verification: generation.verification,
            },
          }
        : target,
    ),
  };
}
