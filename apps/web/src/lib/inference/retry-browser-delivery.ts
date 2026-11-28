export interface BrowserDeliveryRetryPolicy {
  maxAttempts: number;
  maxDelayMs: number;
}

const defaultPolicy: BrowserDeliveryRetryPolicy = {
  maxAttempts: 5,
  maxDelayMs: 2000,
};

/** Retry delivery of one frozen result, never the chargeable inference or claim. */
export async function retryBrowserDelivery<T>(
  send: () => Promise<T>,
  signal: AbortSignal,
  policy: BrowserDeliveryRetryPolicy = defaultPolicy,
): Promise<T> {
  const { maxAttempts, maxDelayMs } = policy;
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const code = (error as { envelope?: { error?: { code?: string } } })
        ?.envelope?.error?.code;
      const transient =
        !code ||
        code === "service_unavailable" ||
        code === "internal_error" ||
        code === "mini_app_error";
      if (!transient || signal.aborted || attempt >= maxAttempts - 1)
        throw error;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(
          finish,
          Math.min(100 * 2 ** attempt, maxDelayMs),
        );
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
      if (signal.aborted) throw error;
    }
  }
}
