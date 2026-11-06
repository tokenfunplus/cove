/** Return only an upstream provider diagnostic that is safe to show to a user. */
export function secureInferenceFailureReason(
  error: unknown,
): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
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
