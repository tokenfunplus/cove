import type {
  SecureInferenceTransport,
  SecureInferenceVerification,
} from "@/lib/inference/secure-inference";
import type { ProviderProfile } from "@cove/api-contract";

/** A fixed non-user probe used only to validate the encrypted NearAI path. */
export const PRIVATE_CONNECTION_PROBE =
  "Return exactly: private connection confirmed.";

type PrivateConnectionTarget = {
  providerId: string;
  modelId: string;
};

type PrivateConnectionProbeStatus =
  "verifying_environment" | "streaming" | "verifying_response";

export type PrivateConnectionProbeResult = "verified" | "failed" | "stopped";

type RunPrivateConnectionProbeInput = {
  transport: SecureInferenceTransport;
  target: PrivateConnectionTarget;
  profile: Pick<ProviderProfile, "id" | "kind" | "configured">;
  signal?: AbortSignal;
  onStatus?: (status: PrivateConnectionProbeStatus) => void;
  /** Exposes the verified receipt so callers can open its evidence details. */
  onVerification?: (verification: SecureInferenceVerification) => void;
  /** Exposes a safe upstream provider diagnostic when the probe fails. */
  onFailure?: (reason?: string) => void;
};

/**
 * Verify the secure route without making a Generation. This operation has no
 * Local Service persistence command, so its fixed probe never joins
 * Conversation History.
 */
export async function runPrivateConnectionProbe({
  transport,
  target,
  profile,
  signal,
  onStatus,
  onVerification,
  onFailure,
}: RunPrivateConnectionProbeInput): Promise<PrivateConnectionProbeResult> {
  let decryptedResponse = false;
  for await (const event of transport.generate(
    {
      target: {
        id: profile.id,
        kind: profile.kind,
        model_id: target.modelId,
        configured: profile.configured,
      },
      configuration: {
        systemPrompt: "",
        temperature: null,
        topP: null,
        maxTokens: null,
      },
      context: [],
      message: PRIVATE_CONNECTION_PROBE,
    },
    signal,
  )) {
    if (signal?.aborted) return "stopped";
    if (
      event.type === "verifying_environment" ||
      event.type === "streaming" ||
      event.type === "verifying_response"
    ) {
      onStatus?.(event.type);
    } else if (event.type === "delta") {
      decryptedResponse = decryptedResponse || event.delta.length > 0;
    } else if (event.type === "failed") {
      onFailure?.(event.reason);
      return "failed";
    } else if (event.type === "completed") {
      onVerification?.(event.verification);
      return decryptedResponse ? "verified" : "failed";
    }
  }
  return signal?.aborted ? "stopped" : "failed";
}
