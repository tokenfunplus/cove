/** Return only an upstream provider diagnostic that is safe to show to a user. */
export function secureInferenceFailureReason(
  error: unknown,
): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "failure" in current
    ) {
      const failure = (
        current as {
          failure?: {
            code?: unknown;
            details?: { status?: unknown; resource?: unknown };
          };
        }
      ).failure;
      if (failure?.code === "api.http_status") {
        const status = failure.details?.status;
        const resource =
          failure.details?.resource === "completion_signature"
            ? "response receipt"
            : "verification";
        if (
          typeof status === "number" &&
          Number.isInteger(status) &&
          status >= 100 &&
          status <= 599
        )
          return `Provider error: The ${resource} request returned HTTP ${status} (api.http_status).`;
      }
      if (failure?.code === "signature.payload_mismatch")
        return "Verification error: The response receipt does not match the captured request and response (signature.payload_mismatch).";
      if (failure?.code === "signature.signer_mismatch")
        return "Verification error: The response signer differs from the verified environment (signature.signer_mismatch).";
      if (failure?.code === "api.completion_signature_unavailable")
        return "Provider error: The response receipt is unavailable (api.completion_signature_unavailable).";
    }
    if (
      current instanceof Error &&
      current.message.startsWith("Provider error:")
    )
      return current.message;
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return undefined;
}
