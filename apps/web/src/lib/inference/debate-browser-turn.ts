import type {
  DebateBrowserContext,
  DebateBrowserProgress,
  DebateBrowserResult,
  GenerationMetrics,
} from "@cove/api-contract";
import { inferenceModeForSnapshot } from "@/components/providers/model-selection";
import {
  failedVerificationForContract,
  secureVerificationForContract,
} from "./verification-record";
import type { SecureInferenceTransport } from "./secure-inference";

type Commands = {
  claim: () => Promise<{
    turn: Pick<DebateBrowserContext["turn"], "snapshot" | "configuration">;
    messages: DebateBrowserContext["messages"];
  }>;
  progress: (input: Omit<DebateBrowserProgress, "claim_id">) => Promise<void>;
  settle: (input: Omit<DebateBrowserResult, "claim_id">) => Promise<unknown>;
  // Debate's first accepted receipt wins. App tasks retain paid output instead.
  failDelivery?: (
    input: Omit<DebateBrowserResult, "claim_id">,
  ) => Promise<unknown>;
};

/** Runs an exclusively claimed browser request with the saved target and messages. */
export async function runVerifiedBrowserTurn(
  commands: Commands,
  signal: AbortSignal,
  loadTransport: () => Promise<SecureInferenceTransport> = async () =>
    (await import("./secure-inference")).createSecureInferenceTransport(),
) {
  // Failure to claim is final for this worker: another tab may already own it.
  const { turn, messages } = await commands.claim();
  const mode = inferenceModeForSnapshot(turn.snapshot);
  let body = "",
    reasoning = "",
    outputBytes = 0;
  let settled = false;
  let verifiedResult = false;
  let phase: NonNullable<DebateBrowserProgress["phase"]> =
    "verifying_environment";
  const started = performance.now();
  let firstDelta: number | undefined, lastDelta: number | undefined;
  let inputTokens: number | undefined, outputTokens: number | undefined;
  let lastProgress = 0;
  const checkAbort = () => {
    if (signal.aborted)
      throw new DOMException("Browser turn interrupted", "AbortError");
  };
  const progress = async (force = false) => {
    checkAbort();
    if (!force && performance.now() - lastProgress < 200) return;
    await commands.progress({ phase, body, reasoning });
    lastProgress = performance.now();
  };
  const metrics = (): GenerationMetrics => {
    const duration = Math.floor(performance.now() - started);
    return {
      source: "browser",
      duration_ms: duration,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ...(firstDelta === undefined
        ? {}
        : {
            time_to_first_token_ms: Math.min(
              duration,
              Math.floor(firstDelta - started),
            ),
            output_duration_ms: Math.floor(
              (lastDelta ?? firstDelta) - firstDelta,
            ),
          }),
    };
  };
  try {
    checkAbort();
    if (!mode || messages.length < 2)
      throw new Error("Unsupported browser verification request");
    const transport = await loadTransport();
    checkAbort();
    const stream = transport.generate(
      {
        target: {
          id: turn.snapshot.provider_id,
          kind: "nearai",
          model_id: turn.snapshot.model_id,
          configured: true,
        },
        mode,
        configuration: {
          systemPrompt: turn.configuration.system_prompt,
          temperature: turn.configuration.temperature,
          topP: turn.configuration.top_p,
          maxTokens: turn.configuration.max_tokens,
        },
        context: messages.slice(1, -1),
        message: messages[messages.length - 1]!.content,
      },
      signal,
    );
    for await (const event of stream) {
      checkAbort();
      if (event.type === "delta" || event.type === "reasoning") {
        outputBytes += new TextEncoder().encode(event.delta).byteLength;
        if (outputBytes > 256 * 1024)
          throw new Error("Verified output exceeded its limit");
        if (event.delta) {
          lastDelta = performance.now();
          firstDelta ??= lastDelta;
        }
        if (event.type === "delta") body += event.delta;
        else reasoning += event.delta;
        await progress();
      } else if (event.type === "usage") {
        inputTokens = event.inputTokens ?? inputTokens;
        outputTokens = event.outputTokens ?? outputTokens;
      } else if (
        event.type === "streaming" ||
        event.type === "verifying_environment" ||
        event.type === "response_ready"
      ) {
        phase =
          event.type === "response_ready" ? "verifying_response" : event.type;
        await progress(true);
      } else if (event.type === "completed") {
        const verification = await secureVerificationForContract(
          event.verification,
          mode,
        );
        checkAbort();
        verifiedResult = true;
        await commands.settle({
          body,
          reasoning,
          verification,
          metrics: metrics(),
        });
        settled = true;
        return;
      } else if (event.type === "failed") {
        await commands.settle({
          body: "",
          verification: failedVerificationForContract(
            mode,
            event.code,
            "NearAI verification could not complete.",
            Boolean(body),
          ),
        });
        settled = true;
        return;
      }
    }
    throw new Error("Browser inference ended without a result");
  } finally {
    if (!settled) {
      const fail = verifiedResult ? commands.failDelivery : commands.settle;
      // A lost ACK must not replace an accepted receipt. Only Debate opts into
      // its first-result-wins cleanup; App tasks keep their verified result.
      await fail?.({
        body: "",
        verification: failedVerificationForContract(
          mode,
          verifiedResult
            ? "browser_delivery_failed"
            : signal.aborted
              ? "browser_interrupted"
              : "secure_transport_error",
          verifiedResult
            ? "The verified result could not be delivered. Resume explicitly to retry this turn."
            : "The browser turn was interrupted before verification completed.",
        ),
      }).catch(() => undefined);
    }
  }
}

export const runDebateBrowserTurn = runVerifiedBrowserTurn;
