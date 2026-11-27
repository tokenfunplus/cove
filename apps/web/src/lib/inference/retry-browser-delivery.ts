/** Retry delivery of one frozen result, never the chargeable inference or claim. */
export async function retryBrowserDelivery<T>(
  send: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
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
      if (!transient || signal.aborted || attempt >= 4) throw error;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 100 * 2 ** attempt);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
      if (signal.aborted) throw error;
    }
  }
}
